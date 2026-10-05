import hashlib
import json
import mimetypes
import os
import tempfile
import time
import zipfile

import requests
from PIL import Image

platformUrl = os.environ["PLATFORM_URL"]
projectId = os.environ["PROJECT_ID"]
apiKey = os.environ["API_KEY"]              
headers = {"Authorization": f"Bearer {apiKey}"}  

TARGET_SIZE = (360,240)
IMAGE_EXTENSIONS = {".jpg",".jpeg",".png", ".gif", ".bmp", ".webp", ".tiff"}
POLL_SECONDS = 20

def patch_source(source_id, payload):
    response = requests.patch(
        f"{platformUrl}/api/v1/projects/{projectId}/sources/{source_id}",
        data=json.dumps(payload),
        headers=headers,
    )
    response.raise_for_status()


def send_error(source_id, message):
    print(f"Error: {message}")
    try:
        patch_source(source_id, {"status": "FAILED", "statusInfo": {"message": message}})
    except requests.RequestException as e:
        print(f"Error: could not mark source {source_id} as FAILED: {e}")


def list_files(root):
    """Split everything extracted under root into images and skipped files.

    Returns (images, skipped). images is a list of (name, absolute_path) where name is
    the path relative to root (so files in sub-folders keep a readable name). macOS
    metadata (__MACOSX/, ._*) and hidden files (.DS_Store) are ignored silently.
    """
    images, skipped = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__MACOSX"]
        for filename in filenames:
            if filename.startswith("."):
                continue
            absolute = os.path.join(dirpath, filename)
            name = os.path.relpath(absolute, root)
            if os.path.splitext(filename)[1].lower() in IMAGE_EXTENSIONS:
                images.append((name, absolute))
            else:
                skipped.append(name)
    return images, skipped


def resize_in_place(path):
    with Image.open(path) as image:
        resized = image.resize(TARGET_SIZE)
    # JPEG cannot hold alpha or palette modes.
    if os.path.splitext(path)[1].lower() in (".jpg", ".jpeg") and resized.mode != "RGB":
        resized = resized.convert("RGB")
    resized.save(path)


def upload_image(source_id, name, path):
    """POST one image to the platform. Returns None on success, or a problem string."""
    content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        response = requests.post(
            f"{platformUrl}/api/v1/projects/{projectId}/sources/{source_id}/files",
            files={"file": (os.path.basename(name), f, content_type)},
            headers=headers,
        )
    if response.status_code == 409 and response.json().get("code") == "DUPLICATE":
        existing = response.json()["existing"]["name"]
        return f"{name} is not unique in the existing sources (same image as {existing})"
    response.raise_for_status()
    return None


def process_source(source):
    source_id = source["id"]
    patch_source(source_id, {"status": "PROCESSING"})

    # Everything happens in a temporary directory that is removed on exit, success or
    # not: nothing is left in the worker's working directory.
    with tempfile.TemporaryDirectory() as workdir:
        zip_path = os.path.join(workdir, "source.zip")
        extract_dir = os.path.join(workdir, "source")

        # Download through the authenticated proxy (File Storage Remediation Plan, Step 4)
        download = requests.get(
            f"{platformUrl}/api/files/{source['fields'][0]['id']}", headers=headers
        )
        download.raise_for_status()
        with open(zip_path, "wb") as f:
            f.write(download.content)

        if not zipfile.is_zipfile(zip_path):
            send_error(source_id, "The file is not a zip file")
            return

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)

        images, skipped = list_files(extract_dir)
        problems = [f"{name} is not an image and was skipped" for name in skipped]

        # Resize, then dedupe inside the zip on the resized bytes (the same bytes the
        # server will checksum, so both dedupe levels agree).
        unique = {}  # checksum -> (name, path)
        for name, path in images:
            try:
                resize_in_place(path)
            except (OSError, ValueError) as e:  # PIL.UnidentifiedImageError is an OSError
                problems.append(f"{name} could not be read as an image ({e})")
                continue
            with open(path, "rb") as f:
                checksum = hashlib.md5(f.read()).hexdigest()
            if checksum in unique:
                problems.append(
                    f"Images {unique[checksum][0]}, {name} have the same checksum {checksum}"
                )
                continue
            unique[checksum] = (name, path)

        # Dedupe against the platform happens server-side (409 DUPLICATE).
        for name, path in unique.values():
            problem = upload_image(source_id, name, path)
            if problem:
                problems.append(problem)

    patch_source(source_id, {"status": "COMPLETED", "statusInfo": {"problems": problems}})


while True:
    try:
        response = requests.get(
            f"{platformUrl}/api/v1/projects/{projectId}/sources?status=PENDING",
            headers=headers,
        )
        response.raise_for_status()
        sources = response.json()
    except (requests.RequestException, ValueError) as e:
        print(f"Error: could not list pending sources: {e}")
        sources = []

    for source in sources:
        # Ignore sources that are not zip files
        if source["type"]["name"] != "zip-file":
            continue
        try:
            process_source(source)
        except Exception as e:
            send_error(source["id"], f"Unexpected error while processing the zip: {e}")

    time.sleep(POLL_SECONDS)

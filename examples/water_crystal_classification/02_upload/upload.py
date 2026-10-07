import hashlib
import json
import mimetypes
import os
import tempfile
import time
import zipfile
import csv
import re

import openpyxl
import requests
from PIL import Image


platformUrl = os.environ["PLATFORM_URL"]
projectId = os.environ["PROJECT_ID"]
apiKey = os.environ["API_KEY"]              
headers = {"Authorization": f"Bearer {apiKey}"}  

TARGET_SIZE = (360,240)
IMAGE_EXTENSIONS = {".jpg",".jpeg",".png", ".gif", ".bmp", ".webp", ".tiff"}
# Label file of an annotated zip: at the zip root, columns image_name;label
# (or the client's own headers, Img_name / Label).
LABEL_EXTENSIONS = {".csv", ".xlsx"}
NAME_HEADERS = {"image_name", "img_name"}
LABEL_HEADERS = {"label"}
#At most this many messages of one kinf are listed; the totals are in the summary.
MAX_LISTED = 15
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
    metadata (__MACOSX/, ._*), hidden files (.DS_Store) and Excel lock files (~$*) are ignored silently.
    """
    images, skipped = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__MACOSX"]
        for filename in filenames:
            # Hidden files, and the lock file Excel leaves next to an open workbook.
            if filename.startswith(".") or filename.startswith("~$"):
                continue
            absolute = os.path.join(dirpath, filename)
            name = os.path.relpath(absolute, root)
            if os.path.splitext(filename)[1].lower() in IMAGE_EXTENSIONS:
                images.append((name, absolute))
            else:
                skipped.append(name)
    return images, skipped

def normalize_code(value):
    """Turn a raw class code into its canonical text.

    Same rules as datasets/epp_dataset/prepare_labels.py (kept in sync by hand; the
    worker does not import from the dataset folder): numbers to text, spaces and
    trailing dots removed, "3.0" -> "3".
    """
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    code = re.sub(r"\s+", "", str(value)).strip(".")
    if re.fullmatch(r"\d+\.0", code):
        code = code[:-2]
    return code


def split_label_files(skipped):
    """Separate the label file candidates (at the zip root) from the other skipped files."""
    candidates = [
        name for name in skipped
        if os.path.dirname(name) == "" and os.path.splitext(name)[1].lower() in LABEL_EXTENSIONS
    ]
    others = [name for name in skipped if name not in candidates]
    return candidates, others


def read_csv_rows(path):
    # utf-8-sig drops the BOM that Excel adds. Names and codes are ASCII, so text in
    # another encoding (for example Shift-JIS in an extra column) is replaced, not fatal.
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        lines = f.read().splitlines()
    if not lines:
        return []
    delimiter = ";" if lines[0].count(";") >= lines[0].count(",") else ","
    return list(csv.reader(lines, delimiter=delimiter))

def read_xlsx_rows(path):
    # First sheet only. data_only reads the values of the cells, not their formulas.
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return [list(row) for row in workbook.worksheets[0].iter_rows(values_only=True)]
    finally:
        workbook.close()


def parse_label_rows(rows):
    """Return [(image_name, code), ...], or None if the two columns are missing."""
    rows = iter(rows)
    header = [str(cell).strip().lower() if cell is not None else "" for cell in next(rows, [])]
    name_col = next((i for i, h in enumerate(header) if h in NAME_HEADERS), None)
    label_col = next((i for i, h in enumerate(header) if h in LABEL_HEADERS), None)
    if name_col is None or label_col is None:
        return None

    entries = []
    for row in rows:
        name = row[name_col] if name_col < len(row) else None
        code = normalize_code(row[label_col] if label_col < len(row) else None)
        if name is None or not str(name).strip() or not code:
            continue
        entries.append((str(name).strip(), code))
    return entries


def read_label_file(path):
    if os.path.splitext(path)[1].lower() == ".xlsx":
        return parse_label_rows(read_xlsx_rows(path))
    return parse_label_rows(read_csv_rows(path))

def capped(messages, what):
    """Keep the first MAX_LISTED messages and say how many were left out."""
    if len(messages) <= MAX_LISTED:
        return messages
    return messages[:MAX_LISTED] + [f"... and {len(messages) - MAX_LISTED} more {what}"]

def match_labels(entries, images):
    """Match label rows to images by file name (case-insensitive, folders ignored).

    Returns (labels, problems, counts). labels maps an image name, as in `images`, to its code.
    A file name that is ambiguous on either side gets no label and is reported.
    """
    rows_by_key = {}  # file name in lower case -> the name as written and its codes
    for image_name, code in entries:
        file_name = os.path.basename(image_name.replace("\\", "/"))
        row = rows_by_key.setdefault(file_name.lower(), {"name": file_name, "codes": set()})
        row["codes"].add(code)

    names_by_key = {}
    for name, _ in images:
        names_by_key.setdefault(os.path.basename(name).lower(), []).append(name)

    labels, conflicts, not_in_zip = {}, [], []
    for key, row in rows_by_key.items():
        names = names_by_key.get(key, [])
        if len(row["codes"]) > 1:
            conflicts.append(
                f"{row['name']} has more than one label in the label file "
                f"({', '.join(sorted(row['codes']))}); none was applied"
            )
        elif len(names) > 1:
            conflicts.append(
                f"Images {', '.join(sorted(names))} have the same file name; "
                "the label was not applied to any of them"
            )
        elif names:
            labels[names[0]] = next(iter(row["codes"]))
        else:
            not_in_zip.append(f"{row['name']} is in the label file but not in the zip")

    without_label = [
        f"{name} has no row in the label file; uploaded without expert category"
        for key, names in names_by_key.items()
        if key not in rows_by_key
        for name in names
    ]

    problems = (
        capped(conflicts, "labels that could not be applied")
        + capped(not_in_zip, "rows of the label file with no image in the zip")
        + capped(without_label, "images with no row in the label file")
    )
    counts = {
        "notInZip": len(not_in_zip),
        "withoutLabel": len(without_label),
        "conflicts": len(conflicts),
    }
    return labels, problems, counts

def resize_in_place(path):
    with Image.open(path) as image:
        resized = image.resize(TARGET_SIZE)
    # JPEG cannot hold alpha or palette modes.
    if os.path.splitext(path)[1].lower() in (".jpg", ".jpeg") and resized.mode != "RGB":
        resized = resized.convert("RGB")
    resized.save(path)


def upload_image(source_id, name, path, expert_code=None):
    """POST one image to the platform.

    Returns (problem, expert). problem is None or a message. expert is "STORED",
    "UNKNOWN_CODE", or None when no code was sent or the image was not stored."""
    content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        response = requests.post(
            f"{platformUrl}/api/v1/projects/{projectId}/sources/{source_id}/files",
            files={"file": (os.path.basename(name), f, content_type)},
            data={"expertCode": expert_code} if expert_code else None,
            headers=headers,
        )
    if response.status_code == 409 and response.json().get("code") == "DUPLICATE":
        existing = response.json()["existing"]["name"]
        problem = f"{name} is not unique in the existing sources (same image as {existing})"
        if expert_code:
            problem += "; its label was not applied"
        return problem, None
    response.raise_for_status()

    expert = response.json().get("expertCategory")
    if not expert:
        return None, None
    if expert["stored"]:
        return None, "STORED"
    return (
        f"{name}: label '{expert['code']}' is not a class of this project; "
        "uploaded without expert category"
    ), "UNKNOWN_CODE"


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
        label_files, skipped = split_label_files(skipped)
        problems = [f"{name} is not an image and was skipped" for name in skipped]

        labels = {}  # image name -> class code given by the expert
        label_summary = None  # filled in when one label file was read
        if len(label_files) > 1:
            problems.append(
                f"More than one label file found ({', '.join(sorted(label_files))}); none was used"
            )
        elif label_files:
            try:
                entries = read_label_file(os.path.join(extract_dir, label_files[0]))
            except Exception as e:
                entries = None
                problems.append(
                    f"The label file {label_files[0]} could not be read ({e}); "
                    "no categories were imported"
                )
            else:
                if entries is None:
                    problems.append(
                        f"The label file {label_files[0]} does not have the columns image_name "
                        "and label; no categories were imported"
                    )
            if entries is not None:
                labels, label_problems, counts = match_labels(entries, images)
                problems.extend(label_problems)
                label_summary = {"file": label_files[0], "rows": len(entries), **counts}

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
        stored, unknown_code = 0, []
        for name, path in unique.values():
            problem, expert = upload_image(source_id, name, path, labels.get(name))
            if expert == "STORED":
                stored += 1
            elif expert == "UNKNOWN_CODE":
                unknown_code.append(problem)
            elif problem:
                problems.append(problem)
        problems.extend(
            capped(unknown_code, "images with a label that is not a class of this project")
        )

    status_info = {"problems": problems}
    if label_summary is not None:
        # Labels that had an image but were not stored for another reason: conflicting
        # rows, images sharing a file name, duplicate or unreadable images.
        not_applied = label_summary.pop("conflicts") + len(labels) - stored - len(unknown_code)
        label_summary.update(stored=stored, unknownCode=len(unknown_code), notApplied=not_applied)
        status_info["labels"] = label_summary
    patch_source(source_id, {"status": "COMPLETED", "statusInfo":status_info})


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

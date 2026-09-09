import time
import os
import requests
import json
import zipfile
from PIL import Image
import hashlib
from collections import defaultdict
from uuid import uuid4
import shutil

platformUrl = os.environ["PLATFORM_URL"]
projectId = os.environ["PROJECT_ID"]
apiKey = os.environ["API_KEY"]              
headers = {"Authorization": f"Bearer {apiKey}"}  


def send_error(source_id, message):
    print(f"Error: {message}")
    requests.patch(
        f"{platformUrl}/api/v1/projects/{projectId}/sources/{source_id}",
        data=json.dumps({"status": "FAILED", "statusInfo": {"message": message}}),
        headers=headers,
    )


while True:
    try:
        response = requests.get(
            f"{platformUrl}/api/v1/projects/{projectId}/sources?status=PENDING",
            headers=headers
        )
        sources = response.json()

        for source in sources:
            # Ignore sources that are not zip files
            source_type = source["type"]["name"]
            if source_type != "zip-file":
                continue

            # requests.patch(
            #     f"{platformUrl}/api/v1/projects/{projectId}/sources/{source['id']}",
            #     data=json.dumps({"status": "PROCESSING"}),
            #     headers=headers,
            # )

            filepath = source["fields"][0]["value"]
            file = f"{platformUrl}/{filepath}"

            # Download the file to disk
            download = requests.get(file)
            with open("source.zip", "wb") as f:
                f.write(download.content)

            # Check if the file is a zip file
            if not zipfile.is_zipfile("source.zip"):
                send_error(source["id"], "The file is not a zip file")
                continue

            # Unzip the file
            with zipfile.ZipFile("source.zip", "r") as zip_ref:
                zip_ref.extractall("source")

            # Resize the images (360, 240)
            target_width = 360
            target_height = 240
            for root, dirs, files in os.walk("source"):
                for file in files:
                    image = Image.open(os.path.join(root, file))
                    resized_image = image.resize((target_width, target_height))
                    resized_image.save(os.path.join(root, file))

            # Calculate the checksum of the images
            checksums = defaultdict(list)
            for root, dirs, files in os.walk("source"):
                for file in files:
                    with open(os.path.join(root, file), "rb") as f:
                        checksums[hashlib.md5(f.read()).hexdigest()].append(file)

            problems = []
            # Check if the images are unique with the provided sources
            for checksum, images in checksums.items():
                if len(images) > 1:
                    problems.append(
                        f"Images {', '.join(images)} have the same checksum {checksum}"
                    )
                # Keep only one image
                checksums[checksum] = images[0]

            # Check if the images are unique with the existing sources (data.csv)
            # image_id, image_checksum, label, dataset
            with open("data/data.csv", "r") as f:
                next(f)  # Skip the first line
                for line in f:
                    image_id, image_checksum, label, dataset = line.strip().split(",")
                    if image_checksum in checksums.keys():
                        problems.append(
                            f"{image_id} is not unique in the existing sources"
                        )
                        checksums.pop(image_checksum)

            # Append the new images to the existing sources
            with open("data/data.csv", "a") as f:
                for checksum, image in checksums.items():
                    f.write(f"{image},{checksum},,unlabelled\n")

            # Move images in the unlabelled folder
            os.makedirs("data", exist_ok=True)
            for checksum, image in checksums.items():
                uuid = str(uuid4())
                os.rename(f"source/{image}", f"data/{uuid}.jpg")
                requests.post(
                    f"{platformUrl}/api/v1/projects/{projectId}/data",
                    data=json.dumps(
                        {
                            "name": image,
                            "type": "IMAGE",
                            "uploadedAt": source["uploadedAt"],
                            "content": f"{uuid}.jpg",
                        }
                    ),
                    headers=headers,
                )

            # Remove source.zip and source folder
            os.remove("source.zip")
            shutil.rmtree("source/")

            requests.patch(
                f"{platformUrl}/api/v1/projects/{projectId}/sources/{source['id']}",
                data=json.dumps(
                    {
                        "status": "COMPLETED",
                        "statusInfo": {"problems": problems},
                    }
                ),
                headers=headers
            )

    except Exception as e:
        print(f"Error: {e}")

    time.sleep(20)

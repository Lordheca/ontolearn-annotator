import json
import time
from io import BytesIO
import os
import numpy as np
import requests
import tensorflow as tf
from PIL import Image

model = tf.keras.models.load_model("/app/model.keras")

# Class list saved by the training notebook next to model.keras, in the order
# of the model's output units. Never hard-code it here: a different order
# would silently attach every probability to the wrong class.
with open("/app/classes.json", encoding="utf-8") as f:
    classes = json.load(f)
if model.output_shape[-1] != len(classes):
    raise SystemExit(
        f"model.keras has {model.output_shape[-1]} outputs but classes.json lists "
        f"{len(classes)} classes; copy both files from the same training run"
    )
names = [f"{c['code']} {c['name_en']}" for c in classes]

platformUrl = os.environ["PLATFORM_URL"]
projectId = os.environ["PROJECT_ID"]
apiKey = os.environ["API_KEY"]
headers = {"Authorization": f"Bearer {apiKey}"}

print(platformUrl)
print(f"Loaded model with {len(names)} classes")

while True:
    try:
        response = requests.get(
            f"{platformUrl}/api/v1/projects/{projectId}/playground-tasks?status=PENDING",
            headers=headers,
        )
        data = response.json()
        # In data, input is a json object with a key 'file' containing the URL of the file to predict
        for task in data:
            task_id = task["id"]

            # Change status to PROCESSING
            requests.patch(
                f"{platformUrl}/api/v1/projects/{projectId}/playground-tasks/{task_id}",
                data=json.dumps({"status": "PROCESSING"}),
                headers=headers,
            )

            file = f"{platformUrl}/api/files/{task_id}"

            #Download the file through the authenticated proxy (File Storage
            #Remediaion Plan, Step 4)
            download = requests.get(file, headers = headers)

            # Resize the image (360, 240)
            target_width = 360
            target_height = 240
            image = Image.open(BytesIO(download.content))

            # Resize the image
            resized_image = image.resize((target_width, target_height))

            # Predict
            image = np.array(resized_image)
            image = np.expand_dims(image, axis=0)
            prediction = model.predict(image)

            print(prediction)

            # Send prediction back to the server
            formatted_prediction = []
            for i in range(len(names)):
                formatted_prediction.append(
                    {"name": names[i], "value": str(prediction[0][i])}
                )

            print(formatted_prediction)

            body = {
                "output": {"prediction": formatted_prediction},
                "status": "COMPLETED",
            }

            print(json.dumps(body))

            requests.patch(
                f"{platformUrl}/api/v1/projects/{projectId}/playground-tasks/{task_id}",
                data=json.dumps(body),
                headers=headers,
            )
    except Exception as e:
        print(e)

    time.sleep(10)

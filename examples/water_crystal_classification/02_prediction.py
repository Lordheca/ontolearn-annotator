import tensorflow as tf
import tensorflow_datasets as tfds
import numpy as np
import requests
import os

# Load the model
model = tf.keras.models.load_model("model.keras")

# Load the data
(_, _, _, unlabelled_ds), metadata = tfds.load(
    "active",
    split=["train", "test", "validation", "unlabelled"],
    shuffle_files=True,
    with_info=True,
)

num_classes = metadata.features["label"].num_classes


def normalize_label(data):
    data["label"] = tf.one_hot(data["label"], num_classes)
    return data


unlabelled_ds = unlabelled_ds.map(normalize_label, num_parallel_calls=tf.data.AUTOTUNE)

least_confident = []
i = 0

for data in unlabelled_ds:
    image = data["image"]
    label = data["label"]
    image = tf.expand_dims(image, axis=0)
    prediction = model.predict(image, verbose=0)

    # Calculate the least confident
    least_confident.append(
        (1 - np.max(prediction), data["image_name"].numpy().decode("utf-8"), prediction)
    )
    least_confident.sort(key=lambda x: x[0], reverse=True)
    least_confident = least_confident[:10]

    if i == 10:
        break
    i += 1

print(least_confident)
apiKey = os.environ["API_KEY"]  
headers = {"Authorization": f"Bearer {apiKey}"}  
project_id = "clzhtmd6x0002fmyrawopx2nm"
for data in least_confident:
    try:
        response = requests.post(
            f"http://localhost:3000/api/v1/projects/{project_id}/tasks",
            json={
                "input": {
                    "image": data[1],
                    "prediction": data[2].tolist(),
                    "confidence": 1 - data[0],
                },
                "type": "image_classification",
            },
            headers=headers,
        )
        if response.status_code != 200:
            print(response.status_code)
            print(response.text)

        print(response.json())
    except Exception as e:
        print(e)
        print("Error")
        break

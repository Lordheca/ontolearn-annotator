"""Inference worker: classifies every stored image of a project.

Polls the platform for the images that MODEL_VERSION has not classified yet, runs the
model on each one and saves the 3 most likely classes as an ML suggestion. It looks at
images, not at uploads, so it covers zips, single images and small batches alike.

Environment:
    PLATFORM_URL   e.g. http://localhost:3000
    PROJECT_ID     id of the project
    API_KEY        project API key (MACHINE role)
    MODEL_DIR      folder with the model file and classes.json of the same training run
    MODEL_FILE     model file name, default model.keras (model_best.keras if chosen)
    MODEL_VERSION  version string stored with every prediction, e.g. epp26-v1.
                   Changing it classifies every image again; old predictions are kept.
"""

import json
import os
import time
from io import BytesIO

import numpy as np
import requests
from PIL import Image


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Environment variable {name} is required")
    return value


platformUrl = required_env("PLATFORM_URL").rstrip("/")
projectId = required_env("PROJECT_ID")
apiKey = required_env("API_KEY")
modelDir = required_env("MODEL_DIR")
modelFile = os.environ.get("MODEL_FILE", "").strip() or "model.keras"
modelVersion = required_env("MODEL_VERSION")
if len(modelVersion) > 50:
    raise SystemExit("MODEL_VERSION must be at most 50 characters")

headers = {"Authorization": f"Bearer {apiKey}"}
projectUrl = f"{platformUrl}/api/v1/projects/{projectId}"

# Width x height. The model input is 240 x 360 x 3 (height x width x channels).
TARGET_SIZE = (360, 240)
TOP_LABELS = 3
POLL_SECONDS = 20
LIST_LIMIT = 200
# An image that failed is left alone for this long, so the loop moves on.
SKIP_SECONDS = 10 * 60
HTTP_TIMEOUT = 60


def log(message):
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


def preprocess(content):
    """Image bytes -> batch of one, exactly as the model was trained.

    Convert to RGB (a PNG with transparency or a greyscale image has another number
    of channels) and resize to 360 x 240. Nothing else: augmentation and
    preprocess_input are layers inside the model. 01_playground/playground.py must
    keep the same lines.
    """
    image = Image.open(BytesIO(content)).convert("RGB").resize(TARGET_SIZE)
    return np.expand_dims(np.array(image), axis=0)


def load_class_codes():
    path = os.path.join(modelDir, "classes.json")
    if not os.path.isfile(path):
        raise SystemExit(f"{path} not found; copy it from the training run of the model")
    with open(path, encoding="utf-8") as f:
        return [str(c["code"]) for c in json.load(f)]


def check_platform_classes(codes):
    """Refuse to start unless every class of the model exists on the platform.

    This is what guarantees that a prediction can always be saved.
    """
    try:
        response = requests.get(f"{projectUrl}/class-types", headers=headers, timeout=HTTP_TIMEOUT)
    except requests.RequestException as e:
        raise SystemExit(f"Could not reach the platform at {platformUrl}: {e}")
    if response.status_code == 401:
        raise SystemExit("The platform refused the API key (wrong key or wrong PROJECT_ID)")
    if response.status_code != 200:
        raise SystemExit(f"Could not read the project's classes: HTTP {response.status_code}")

    platform_codes = {c["code"] for c in response.json()}
    missing = [code for code in codes if code not in platform_codes]
    if missing:
        raise SystemExit(
            f"{len(missing)} class code(s) of classes.json are not active classes of the "
            f"project: {', '.join(missing)}. Import classes.csv in Settings > Class types, "
            "or use the classes.json of this model."
        )


def load_model(class_count):
    path = os.path.join(modelDir, modelFile)
    if not os.path.isfile(path):
        raise SystemExit(f"{path} not found")
    # Imported here so the checks above fail fast, before TensorFlow starts.
    import tensorflow as tf

    model = tf.keras.models.load_model(path)
    if model.output_shape[-1] != class_count:
        raise SystemExit(
            f"{modelFile} has {model.output_shape[-1]} outputs but classes.json lists "
            f"{class_count} classes; copy both files from the same training run"
        )
    return model


def list_pending():
    response = requests.get(
        f"{projectUrl}/data-files",
        params={"withoutPrediction": modelVersion, "limit": LIST_LIMIT},
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def classify(model, codes, data_file):
    download = requests.get(
        f"{platformUrl}/api/files/{data_file['id']}", headers=headers, timeout=HTTP_TIMEOUT
    )
    download.raise_for_status()

    probabilities = model.predict(preprocess(download.content), verbose=0)[0]
    top = np.argsort(probabilities)[::-1][:TOP_LABELS]
    labels = [
        {"code": codes[i], "confidence": min(1.0, max(0.0, float(probabilities[i])))}
        for i in top
    ]

    response = requests.post(
        f"{projectUrl}/data-files/{data_file['id']}/predictions",
        json={"modelVersion": modelVersion, "labels": labels},
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"HTTP {response.status_code} saving the prediction: {response.text[:200]}")
    return labels


def poll(model, codes, skip_until):
    """One pass over the pending images. Returns True if the list came back full."""
    data_files = list_pending()

    now = time.monotonic()
    for data_file_id in [i for i, until in skip_until.items() if until <= now]:
        del skip_until[data_file_id]
    todo = [d for d in data_files if d["id"] not in skip_until]

    if data_files and not todo:
        log(
            f"All {len(data_files)} pending image(s) failed recently and are waiting to be "
            "retried; newer images may be waiting behind them."
        )
        return False

    done = 0
    for data_file in todo:
        try:
            labels = classify(model, codes, data_file)
            done += 1
            log(f"{data_file['name']}: {labels[0]['code']} ({labels[0]['confidence']:.2f})")
        except Exception as e:  # one bad image must never stop the loop
            skip_until[data_file["id"]] = time.monotonic() + SKIP_SECONDS
            log(f"Error: {data_file['name']} ({data_file['id']}) skipped for 10 minutes: {e}")

    if todo:
        log(f"Classified {done} image(s), {len(todo) - done} failed")
    return len(data_files) == LIST_LIMIT and done > 0


def main():
    codes = load_class_codes()
    check_platform_classes(codes)
    model = load_model(len(codes))
    log(f"Model {modelFile} loaded with {len(codes)} classes; version {modelVersion}")

    skip_until = {}  # data file id -> time.monotonic() when it can be retried
    while True:
        more = False
        try:
            more = poll(model, codes, skip_until)
        except (requests.RequestException, ValueError) as e:
            log(f"Error: could not list the pending images: {e}")
        if not more:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
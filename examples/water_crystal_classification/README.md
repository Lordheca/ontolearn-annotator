# Water Crystal Model

Classification and segmentation of water crystals with deep-learning and active learning

## Datasets

- [5K EPP Water Crystal Dataset](https://ieee-dataport.org/documents/5k-epp-water-crystal-dataset): The 5K EPP Dataset includes 5007 photos of water crystaks classified in 13 categories. This dataset was created under the leaderhip of Prof. Masaru Emoto.

## Installation

Create a virtual environment with the following command:

```bash
python -m venv .venv
source .venv/bin/activate
```

You can install the required packages with the following command:

```bash
pip install -r requirements.txt
```

You need to build the dataset. First copy the dataset in the `epp_dataset/data` folder. It must be include a file called `5k_epp_dataset.csv` with `image_name` and `label` columns and the images in the `images` folder. Then you can run the following command:

```bash
tdfs build ./datasets/epp_dataset
```

## Inference worker

`03_inference/inference.py` classifies every image stored in a project. Every 20 seconds
it asks the platform for the images that the current model version has not classified
yet, runs the model on each one and saves the 3 most likely classes, with their
confidence, as the ML suggestion shown in the Annotator. It looks at images, not at
uploads, so it covers zip files, single images and small batches.

The platform keeps working when the worker is stopped: images can be uploaded and
annotated, and their suggestion shows as pending until the worker runs again.

### Configuration

| Variable | Meaning |
|---|---|
| `PLATFORM_URL` | URL of the platform, for example `http://localhost:3000` |
| `PROJECT_ID` | Id of the project |
| `API_KEY` | Project API key: `npx tsx scripts/create-api-key.ts <projectId> inference-worker` |
| `MODEL_DIR` | Folder with the model file and the `classes.json` of the same training run |
| `MODEL_FILE` | Model file name. Default `model.keras`; use `model_best.keras` if that is the chosen one |
| `MODEL_VERSION` | Version stored with every prediction, for example `epp26-v1` (50 characters at most) |

Changing `MODEL_VERSION` makes the worker classify every image again. The predictions
of the previous versions are kept.

### Run it

Use the training environment (`.venv` in this folder), not the one of `02_upload`:
the model only loads with the TensorFlow and Keras versions it was saved with
(`03_inference/requirements.txt`).

```bash
source .venv/bin/activate
PLATFORM_URL=http://localhost:3000 PROJECT_ID=<projectId> API_KEY=<key> \
MODEL_DIR=01_playground MODEL_VERSION=epp26-v1 \
python3 03_inference/inference.py
```

With Docker, put the same variables in a `.env` file next to `docker-compose.yml`
and run the commands below. The model folder is `./01_playground` unless
`INFERENCE_MODEL_DIR` says otherwise (a path relative to `docker-compose.yml`);
`MODEL_DIR` is ignored here.

```bash
docker compose up -d --build inference
docker compose logs -f inference
```

Inside the container `localhost` is the container itself. If the platform runs on the
same machine, set `PLATFORM_URL=http://host.docker.internal:3000`.

### Start-up checks

The worker refuses to start, with a message that says why, when:

- a variable is missing, or the model file or `classes.json` is not in `MODEL_DIR`;
- the API key is refused, or the platform cannot be reached;
- a class code of `classes.json` is not an active class of the project (import
  `datasets/epp_dataset/classes.csv` in *Settings > Class types*);
- the model does not have one output per class of `classes.json`.

### Images that fail

An image that cannot be downloaded, read or saved is logged and left alone for 10
minutes, then tried again. The other images are not affected. Nothing is written to
the platform for an image that fails.

## Author

Made by [Mathis Boultoureau](https://github.com/mboultoureau)
Enhanced by [Miguel Hernandez]
"""epp_dataset dataset."""

import tensorflow_datasets as tfds
from pathlib import Path
import csv
import random
from PIL import Image
import hashlib
import tensorflow as tf

class Builder(tfds.core.GeneratorBasedBuilder):
    """DatasetBuilder for 5K EPP Water Crystal dataset."""

    VERSION = tfds.core.Version("1.0.0")
    RELEASE_NOTES = {
        "1.0.0": "Initial release.",
    }

    classes = {
        "1": "microparticule",
        "2": "simple_plate",
        "3": "fan_like_plate",
        "4": "dentrite_plate",
        "5": "fern_like_dentrite_plate",
        "6": "column_square",
        "7": "singular_irregular",
        "8": "cloud_particle",
        "9": "combinations",
        "10": "double_plate",
        "11": "multiple_columns_squares",
        "12": "multiple_irregulars",
        "13": "undefined",
    }

    def _info(self) -> tfds.core.DatasetInfo:
        """Returns the dataset metadata."""
        # TODO(epp_dataset): Specifies the tfds.core.DatasetInfo object
        return self.dataset_info_from_configs(
            features=tfds.features.FeaturesDict(
                {
                    # These are the features of your dataset like images, labels ...
                    "image": tfds.features.Image(shape=(240, 360, 3)),
                    "label": tfds.features.ClassLabel(
                        names=[
                            "microparticule",
                            "simple_plate",
                            "fan_like_plate",
                            "dentrite_plate",
                            "fern_like_dentrite_plate",
                            "column_square",
                            "singular_irregular",
                            "cloud_particle",
                            "combinations",
                            "double_plate",
                            "multiple_columns_squares",
                            "multiple_irregulars",
                            "undefined",
                        ]
                    ),
                }
            ),
            # If there's a common (input, target) tuple from the
            # features, specify them here. They'll be used if
            # `as_supervised=True` in `builder.as_dataset`.
            supervised_keys=("image", "label"),  # Set to `None` to disable
            homepage="https://ieee-dataport.org/documents/5k-epp-water-crystal-dataset",
        )

    def _split_generators(self, dl_manager: tfds.download.DownloadManager):
        """Returns SplitGenerators."""
        # TODO(epp_dataset): Downloads the data and defines the splits
        path = Path("./datasets/epp_dataset/data")

        # TODO(epp_dataset): Returns the Dict[split names, Iterator[Key, Example]]
        return {
            "train": self._generate_examples(
                label_path=path / "train_labels.csv"
            ),
            "test": self._generate_examples(
                label_path=path / "test_labels.csv"
            ),
            "validation": self._generate_examples(
                label_path=path / "validation_labels.csv"
            ),
        }
    
    def _initalize_dataset(self):
        print("Label file not found, separating CSV into 3 files")
        path = Path("./datasets/epp_dataset/data")

        # In the images folder, resize all data/images to 360 * 240
        image_folder_path = path / "images"
        image_files = [file for file in tf.io.gfile.listdir(image_folder_path) if file.endswith(".jpg")]

        for image_file in image_files:
            image_path = tf.io.gfile.join(image_folder_path, image_file)
            image = Image.open(image_path)

            resized_image = image.resize((360, 240))
            resized_image.save(image_path)

            image.close()

        # Check all checksums of all images to find overlapping image and remove one of them from images folder
        # and the csv file
        overlapping_images = []
        file_hashes = {}
        for file in tf.io.gfile.listdir(image_folder_path):
            file_path = tf.io.gfile.join(image_folder_path, file)
            with open(file_path, 'rb') as f:
                file_hash = hashlib.md5(f.read()).hexdigest()

            if file_hash in file_hashes:
                overlapping_images.append((file, file_hashes[file_hash]))
            else:
                file_hashes[file_hash] = file

        # Remove the file and the entry from CSV file
        for img1, img2 in overlapping_images:
            tf.io.gfile.remove(image_folder_path / img1)
            with open(path / "5k_epp_dataset.csv") as f:
                reader = csv.DictReader(f, delimiter=";")
                rows = [row for row in reader]
                for row in rows:
                    print(row, img1)
                    if row['image_name'] == img1:
                        rows.remove(row)
                with open(path / "5k_epp_dataset.csv", "w") as f:
                    writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                    writer.writeheader()
                    writer.writerows(rows)

        # Remove rows with missing images
        with open(path / "5k_epp_dataset.csv") as f:
            reader = csv.DictReader(f, delimiter=";")
            rows = [row for row in reader]
            for row in rows:
                if not tf.io.gfile.exists(image_folder_path / row['image_name']):
                    rows.remove(row)
            with open(path / "5k_epp_dataset.csv", "w") as f:
                writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(rows)

        # Shuffle and separate in 80% train, 10% test, 10% validation
        with open(path / "5k_epp_dataset.csv") as f:
            reader = csv.DictReader(f, delimeter=";")
            rows = [row for row in reader]
            random.shuffle(rows)
            total = len(rows)
            train = int(total * 0.8)
            test = int(total * 0.1)
            validation = total - train - test
            print(f"Total: {total}, Train: {train}, Test: {test}, Validation: {validation}")
            train_rows = rows[:train]
            test_rows = rows[train:train+test]
            validation_rows = rows[train+test:]
            with open(path / "train_labels.csv", "w") as f:
                writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(train_rows)
            with open(path / "test_labels.csv", "w") as f:
                writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(test_rows)
            with open(path / "validation_labels.csv", "w") as f:
                writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(validation_rows)

    def _generate_examples(self, label_path):
        """Yields examples."""
        # Check if the label_path exists and separate the CSV into 3 files if it doesn't
        if not label_path.exists():
            self._initalize_dataset()
            
        with label_path.open() as f:
          for row in csv.DictReader(f, delimiter=";"):
            image_id = row['image_name']
            # And yield (key, feature_dict)
            yield image_id, {
                'label': self.classes[row['label']],
                'image': f"datasets/epp_dataset/data/images/{image_id}",
            }
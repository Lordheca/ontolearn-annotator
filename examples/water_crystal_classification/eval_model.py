"""Evaluate the trained model on the test split, per class.

Compares the last-epoch weights (model.keras) with the best-validation
weights (checkpoint.weights.h5) and, if the checkpoint is better, saves it
as model_best.keras. Run from examples/water_crystal_classification.
"""

import json

import numpy as np
import tensorflow as tf
import tensorflow_datasets as tfds
from sklearn.metrics import classification_report, confusion_matrix

import datasets.epp_dataset  # noqa: F401  (registers the 'epp' builder)

test_ds, metadata = tfds.load("epp", split="test", as_supervised=True, with_info=True)
codes = metadata.features["label"].names
with open("classes.json", encoding="utf-8") as f:
    display = {c["code"]: f"{c['code']} {c['name_en']}" for c in json.load(f)}

batches = test_ds.batch(32)
y_true = np.concatenate([labels.numpy() for _, labels in batches])


def predict(model):
    return np.argmax(model.predict(batches, verbose=0), axis=1)


model = tf.keras.models.load_model("model.keras")
pred_last = predict(model)
model.load_weights("checkpoint.weights.h5")
pred_best = predict(model)

acc_last = (pred_last == y_true).mean()
acc_best = (pred_best == y_true).mean()
print(f"Test images: {len(y_true)}")
print(f"Last epoch  (model.keras):           test accuracy = {acc_last:.4f}")
print(f"Best val    (checkpoint.weights.h5): test accuracy = {acc_best:.4f}")

if acc_best > acc_last:
    model.save("model_best.keras")
    print("Checkpoint is better -> saved as model_best.keras")
    pred = pred_best
else:
    pred = pred_last

print()
print(classification_report(
    y_true, pred,
    labels=range(len(codes)),
    target_names=[display[c] for c in codes],
    zero_division=0,
))

cm = confusion_matrix(y_true, pred, labels=range(len(codes)))
pairs = [
    (cm[i, j], codes[i], codes[j])
    for i in range(len(codes)) for j in range(len(codes))
    if i != j and cm[i, j] > 0
]
print("Most frequent confusions (true -> predicted):")
for count, true_code, pred_code in sorted(pairs, reverse=True)[:10]:
    print(f"  {count:3d}  {display[true_code]}  ->  {display[pred_code]}")
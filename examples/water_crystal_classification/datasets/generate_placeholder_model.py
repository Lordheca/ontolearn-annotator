# generate_placeholder_model.py
# Modelo SIN ENTRENAR, solo para verificar el pipeline de Step 4 mientras
# se consigue el CSV real de etiquetas. No usar para nada que dependa de
# que las predicciones sean correctas.

import tensorflow as tf
from pathlib import Path

IMG_HEIGHT = 240
IMG_WIDTH = 360
CLASS_NAMES = [
    "microparticule", "simple_plate", "fan_like_plate", "dentrite_plate",
    "fern_like_dentrite_plate", "column_square", "singular_irregular",
    "cloud_particle", "combinations", "double_plate",
    "multiple_columns_squares", "multiple_irregulars", "undefined",
]

inputs = tf.keras.Input(shape=(IMG_HEIGHT, IMG_WIDTH, 3))
x = tf.keras.layers.Rescaling(scale=1.0 / 127.5, offset=-1.0)(inputs)
base_model = tf.keras.applications.InceptionResNetV2(
    input_shape=(IMG_HEIGHT, IMG_WIDTH, 3),
    include_top=False,
    weights=None,  # sin pesos de imagenet - no hace falta descargar nada para esto
)
x = base_model(x)
x = tf.keras.layers.GlobalMaxPool2D()(x)
outputs = tf.keras.layers.Dense(len(CLASS_NAMES), activation="softmax")(x)
model = tf.keras.Model(inputs, outputs)

output_path = Path(__file__).resolve().parent.parent / "01_playground" / "model.keras"
output_path.parent.mkdir(parents=True, exist_ok=True)
model.save(output_path)
print(f"Modelo placeholder guardado en {output_path}")
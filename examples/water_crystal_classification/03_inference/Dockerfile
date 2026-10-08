# Same TensorFlow and Keras as the training environment: a model saved by one Keras
# version may not load in another.
FROM tensorflow/tensorflow:2.17.0-gpu

COPY 03_inference/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
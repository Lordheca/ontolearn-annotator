FROM tensorflow/tensorflow:latest-gpu

# Install Pillow
RUN apt-get update && apt-get install -y libsm6 libxext6 libxrender-dev
RUN pip install tensorflow==2.17.0 keras==3.4.1 Pillow requests
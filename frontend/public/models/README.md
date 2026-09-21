# Person segmentation model

`selfie_segmenter.tflite` is Google's MediaPipe Selfie Segmenter (float16, version 1).

- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf
- Guide: https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter

The single confidence mask identifies the person. The reel editor composites it
locally over the selected template; no video frames are sent to a segmentation
service. Runtime WASM assets come from the pinned `@mediapipe/tasks-vision` package
and are emitted by Vite. Keep the package's loader and WASM versions together.

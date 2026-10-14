# Voice model

`voice-resnet34.onnx` is the WeSpeaker ResNet34-LM speaker-embedding model trained on VoxCeleb,
in the ONNX export published by the sherpa-onnx project
(`wespeaker_en_voxceleb_resnet34_LM.onnx`, speaker-recognition-models release).

- Model: WeSpeaker, https://github.com/wenet-e2e/wespeaker
- Export: sherpa-onnx, https://github.com/k2-fsa/sherpa-onnx
- License: Creative Commons Attribution 4.0 International (CC BY 4.0), following the VoxCeleb
  dataset it was trained on, as stated in WeSpeaker's pretrained-model documentation.
  https://creativecommons.org/licenses/by/4.0/

The file is unchanged. MicReady downloads it only when a visitor turns on voice profiles, and runs it
in the visitor's browser.

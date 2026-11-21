// Camera module (role B1): open the camera, guide the framing and take the sharpest still for POST /scan.
export { openCamera, describeStream, type OpenCameraOptions } from './open.ts'
export { captureStill, captureStillDetailed, type StillOptions, type StillResult } from './still.ts'
export { startFramingGuide, type FramingGuide, type FramingGuideOptions, type CaptureInfo } from './guide.ts'
export { FramingJudge, HintGate, hintText, DEFAULT_THRESHOLDS, type FramingHint, type FramingThresholds, type FrameSample, type Verdict } from './framing.ts'
export { pickCamera, logitechScore, type CameraInfo } from './select.ts'
export { frameMetrics, laplacianVariance, type FrameMetrics } from './sharpness.ts'
export { shutterBeep } from './shutter.ts'

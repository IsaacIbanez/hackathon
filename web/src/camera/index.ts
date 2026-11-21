// Camera module (role B1): open the camera and take the sharpest still for POST /scan.
export { openCamera, describeStream, type OpenCameraOptions } from './open.ts'
export { captureStill, captureStillDetailed, type StillOptions, type StillResult } from './still.ts'
export { pickCamera, logitechScore, type CameraInfo } from './select.ts'
export { frameMetrics, laplacianVariance, type FrameMetrics } from './sharpness.ts'

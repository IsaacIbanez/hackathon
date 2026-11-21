// Live captions (role B1, Pau; brief in docs/briefs/pau.md). The app shows <LiveCaptions />.
export { LiveCaptions, type LiveCaptionsProps } from './LiveCaptions.tsx'
export { AudioCapture, listMicrophones, preferredMicrophone, canCaptureCallAudio, type Microphone } from './audio.ts'
export { CaptionsConnection, captionsBaseUrl } from './client.ts'
export { applyEvent, transcriptText, emptyState, type CaptionsState, type CaptionLine, type CaptionsEvent } from './transcript.ts'

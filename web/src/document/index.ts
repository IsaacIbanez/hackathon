// Document module (role B2): guided line-by-line reading of the scanned document.
export { GuidedReader } from './GuidedReader.tsx'
export {
  LineReader,
  UNCLEAR,
  keyAction,
  readingOrder,
  speechLang,
  spokenText,
  type ReaderAction,
  type ReaderLine,
  type ReaderState,
  type ReaderStatus,
  type ReaderVoice,
} from './reader.ts'
export { defaultVoice, silentVoice, webSpeechVoice, type SynthLike, type WebSpeechVoice } from './voice.ts'

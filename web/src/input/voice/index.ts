// Voice for the assistant (role C): speaking (Speaker) and listening (listeners + VoiceInput).
export { Speaker, chooseVoice, type SpeakerOptions } from "./speaker.ts";
export { AutoListener, WebSpeechListener, WhisperListener, ListenError, type Listener, type ListenOptions } from "./listener.ts";
export { VoiceInput, DEFAULT_QUESTION, type VoiceState, type AskResult, type SpeechOutput } from "./voiceInput.ts";
export { parseCommand, type VoiceCommand } from "./commands.ts";
export { beep, type Earcon } from "./earcons.ts";
export { splitSentences } from "./text.ts";

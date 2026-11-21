// Alias cómodos sobre los tipos generados (types.ts se genera con `task gen`, no se edita).
import type { components } from "./types";

type S = components["schemas"];

export type Envelope = S["Envelope"];
export type MessageType = S["MessageType"];
export type Box = S["Box"];
export type TextBlock = S["TextBlock"];
export type FrameIssue = S["FrameIssue"];
export type FrameQuality = S["FrameQuality"];

export type DocumentPayload = S["DocumentPayload"];
export type PointerPayload = S["PointerPayload"];
export type UtterancePayload = S["UtterancePayload"];
export type SpeakPayload = S["SpeakPayload"];

export type DocumentMessage = S["DocumentMessage"];
export type PointerMessage = S["PointerMessage"];
export type UtteranceMessage = S["UtteranceMessage"];
export type SpeakMessage = S["SpeakMessage"];

/** Lo que envía el navegador a Go. */
export type ClientMessage = S["ClientMessage"];
/** Lo que envía Go al navegador. */
export type ServerMessage = S["ServerMessage"];

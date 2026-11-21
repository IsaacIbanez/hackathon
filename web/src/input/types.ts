// Shared types for the hand module (role C).
// Image coordinates: normalized [0,1] over the camera frame WITHOUT mirroring
// (the same ones B1 uses for the document). x grows to the right, y grows downwards.

export interface Point {
  x: number;
  y: number;
}

export interface Point3D extends Point {
  z: number;
}

/** A hand detected in a frame (21 landmarks in MediaPipe order). */
export interface Hand {
  /** 21 landmarks in normalized image coordinates. */
  points: Point3D[];
  /** 21 landmarks in metres, centred on the hand (more reliable for the pose). Optional. */
  worldPoints?: Point3D[];
  /** "Left" or "Right" according to MediaPipe. */
  handedness?: string;
  /** Detection confidence [0,1]. */
  score?: number;
}

/** Detected face (MediaPipe FaceLandmarker), for the experimental head gestures. */
export interface Face {
  /** 478 landmarks in normalized image coordinates. */
  points: Point3D[];
}

export interface HandFrame {
  /** Timestamp in milliseconds. */
  t: number;
  hands: Hand[];
  /** Only present when face detection is enabled. */
  face?: Face | null;
  /** Frame width / height, to measure image distances without distortion. */
  aspect?: number;
}

export type Gesture =
  | "none"
  | "point"
  | "palm"
  | "fist"
  | "thumbs_up"
  | "thumbs_down"
  | "pinch";

export type Direction = "left" | "right";

/**
 * Quick menu cells, from the user's point of view: the screen is split into a 3×3 grid and the
 * centre is empty. Menus that only use the cross (up, right, down, left) ignore the corners.
 */
export type MenuSector = "up" | "right" | "down" | "left" | "up_left" | "up_right" | "down_left" | "down_right";

/** What the pinch level controls. */
export type LevelTarget = "volume" | "brightness";

/** Mouse button events from the click gesture (index pointing, middle finger touching the thumb). */
export type MouseAction = "down" | "up" | "click" | "right_click";

/** The user's hand (their real right or left, not the image's). */
export type HandSide = "right" | "left";

export type HeadGesture = "nod" | "shake";

/** Document corners in image coordinates: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point];

export type HandEvent =
  | { type: "hand"; present: boolean; t: number }
  | { type: "gesture"; gesture: Gesture; t: number }
  | { type: "swipe"; direction: Direction; t: number }
  | {
      type: "pointer";
      image: Point;
      /** Position on the document [0,1]x[0,1], or null if there is no document or it falls outside. */
      document: Point | null;
      t: number;
    }
  | { type: "select"; image: Point; document: Point | null; t: number }
  // ---- Experimental ----
  /** Sleep/wake mode (only with `requireWake`). */
  | { type: "mode"; awake: boolean; t: number }
  /**
   * Level (volume) control with the pinch: it starts by touching the thumb and index fingertips,
   * and the level is the distance between them, from 0 (together) to 1 (wide apart).
   */
  | {
      type: "level";
      phase: "armed" | "start" | "move" | "end" | "cancel";
      value: number;
      /** What it controls: volume (default) or screen brightness. */
      target: LevelTarget;
      t: number;
    }
  /**
   * Mouse buttons (only with `mouseClicks`): tap = click, two quick taps = right click, holding =
   * button held down (drag) until released.
   */
  | { type: "mouse"; action: MouseAction; t: number }
  /** Menu opened with ✊ (fist); an option is chosen by holding the pointer (☝️) over it. */
  | {
      type: "menu";
      phase: "open" | "highlight" | "choose" | "close" | "back";
      sector: MenuSector | null;
      /** Menu centre in image coordinates (for drawing). */
      center: Point;
      /** Hand used for the menu: its side is removed (pointing outwards with that hand is awkward). */
      hand: HandSide | null;
      t: number;
    }
  | { type: "head"; gesture: HeadGesture; t: number };

/** Indices of the 21 MediaPipe Hands landmarks. */
export const L = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Connections used to draw the hand skeleton. */
export const CONNECTIONS: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

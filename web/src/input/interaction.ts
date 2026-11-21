// Hand interaction controller: receives frames with landmarks and emits high-level events
// (stable gesture, swipe, pointer, dwell selection and, as experimental features, sleep/wake mode,
// pinch level, quick menu and head gestures).
// It does not depend on MediaPipe or the DOM, so it can be tested with synthetic data.

import { HeadGestureDetector, type HeadOptions } from "./head.ts";
import { OneEuroFilter } from "./filter.ts";
import { applyHomography, distance, distance2D, documentHomography, mean } from "./geometry.ts";
import {
  classifyPose,
  DEFAULT_THRESHOLDS,
  fingerState,
  handSize,
  indexReach,
  shapePoints,
  straightness,
  type Thresholds,
} from "./poses.ts";
import {
  L,
  type Corners,
  type Gesture,
  type Hand,
  type HandEvent,
  type HandFrame,
  type HandSide,
  type LevelTarget,
  type MenuSector,
  type MouseAction,
  type Point,
} from "./types.ts";

export interface InteractionOptions {
  /** How long a pose must be held (with the hand still) before it is emitted. */
  gestureHoldMs: number;
  /** Maximum palm-centre movement during that time (image-height units). */
  gestureStillness: number;
  /** Time without a hand before it is considered lost. */
  handLostMs: number;
  /** Time window to detect a swipe. */
  swipeWindowMs: number;
  /** Minimum horizontal travel (fraction of the width) for a swipe. */
  swipeDistance: number;
  /** Pause after a swipe during which no other gestures are detected. */
  swipeCooldownMs: number;
  /** Time pointing still for it to count as a selection ("dwell click"). */
  dwellMs: number;
  /** Pointer stillness radius for the dwell (image-height units). */
  dwellRadius: number;
  /** Minimum interval between pointer events (limits traffic). */
  pointerIntervalMs: number;
  /** How far the pointer leads past the index tip, in lengths of the last phalanx. */
  pointerLead: number;
  /** true if the camera faces the user (directions are given from their point of view). */
  mirror: boolean;
  /**
   * Swaps MediaPipe's handedness label. Tested with a webcam: without swapping, the label already
   * matches the user's real hand, so it defaults to false.
   */
  invertHandedness: boolean;
  thresholds: Thresholds;

  // ---- Experimental ----
  /**
   * If true, gestures are ignored until the user "wakes" the detector by holding an open palm.
   * Waking is deliberately strict (see the wake* options) so it doesn't happen by accident.
   */
  requireWake: boolean;
  /** Time holding a still, strict open palm to wake. */
  wakeMs: number;
  /** Wake palm: minimum straightness of each of the four fingers (1 = perfectly straight). */
  wakeStraightness: number;
  /** Wake palm: fingers spread, as index-tip-to-pinky-tip distance ÷ hand size. */
  wakeSpread: number;
  /** Wake palm: maximum tilt of the hand from upright, in degrees. */
  wakeUprightDeg: number;
  /** Idle time before going back to sleep. */
  sleepMs: number;
  /**
   * Volume scale. The measure is simple: ON-SCREEN distance between the thumb and index fingertips
   * divided by the hand's on-screen size (wrist → middle knuckle), so it doesn't depend on how close
   * the hand is to the camera. It is the line that gets drawn.
   * Measure ≤ levelZero is 0 %, ≥ levelFull is 100 %, linear in between.
   * To start, the fingers must be brought into the 0 % zone.
   */
  levelZero: number;
  levelFull: number;
  /** Level step size (0.1 = 0 %, 10 %, 20 %…). */
  levelStep: number;
  /** Extra margin (fraction of a step) to change step: avoids flicker at the boundary. */
  levelHysteresis: number;
  /** Time held still on the same step to confirm the value. */
  levelConfirmMs: number;
  /** Time the pinch must be held to start controlling the level. */
  levelStartMs: number;
  /** After choosing "adjust volume" in the menu, time to pinch before cancelling. */
  levelArmMs: number;
  /** Index reach below which the hand counts as closed (fist). */
  fistReach: number;
  /** If true, closing the fist also ends the volume/brightness control (it always opens the menu). */
  useFist: boolean;
  /** The fist must be held this long (and still) to open the menu; inside the menu, to close it. */
  menuHoldMs: number;
  /**
   * Mouse buttons with the hand: while pointing with the index, touching the middle fingertip to the
   * thumb tip presses the button. A short tap is a click, two quick taps a right click, and holding
   * keeps the button down (drag) until the fingers separate. Disables the dwell selection.
   */
  mouseClicks: boolean;
  /** Middle–thumb distance (÷ hand size) below which the button is pressed… */
  clickPress: number;
  /** …and above which it is released (hysteresis, so it doesn't flicker). */
  clickRelease: number;
  /** To press, the middle fingertip must be at least this far from the wrist (÷ hand size). */
  clickReach: number;
  /** Holding the fingers together longer than this is a drag (button held), not a tap. */
  dragMs: number;
  /** A second tap within this time after the first one makes a right click. */
  doubleTapMs: number;
  /** If true, the palm only counts when the palm (not the back of the hand) faces the camera. */
  palmMustFaceCamera: boolean;
  /** Time holding the pointer over a menu option to choose it. */
  menuSelectMs: number;
  /** After opening the menu, the hand is ignored for this long (it is still settling). */
  menuSettleMs: number;
  /** The menu closes on its own after this long. */
  menuTimeoutMs: number;
  /** Head gesture detector options. */
  head: Partial<HeadOptions>;
  /**
   * With several hands in view, the one nearest the camera (largest in the image) is followed. To
   * avoid jumping between two similar hands, another hand only takes over when it is this many
   * times larger than the current one.
   */
  switchHandRatio: number;
}

export const DEFAULT_OPTIONS: InteractionOptions = {
  gestureHoldMs: 300,
  gestureStillness: 0.06,
  handLostMs: 300,
  swipeWindowMs: 400,
  swipeDistance: 0.2,
  swipeCooldownMs: 700,
  dwellMs: 900,
  dwellRadius: 0.025,
  pointerIntervalMs: 66,
  pointerLead: 0.5,
  mirror: true,
  invertHandedness: false,
  thresholds: DEFAULT_THRESHOLDS,
  requireWake: false,
  wakeMs: 1200,
  wakeStraightness: 0.93,
  wakeSpread: 0.8,
  wakeUprightDeg: 40,
  sleepMs: 10000,
  levelZero: 0.25,
  levelFull: 1.0,
  levelStep: 0.1,
  levelHysteresis: 0.25,
  levelConfirmMs: 1000,
  levelStartMs: 150,
  fistReach: 0.9,
  levelArmMs: 8000,
  useFist: false,
  menuHoldMs: 500,
  mouseClicks: false,
  clickPress: 0.3,
  clickRelease: 0.45,
  clickReach: 0.9,
  dragMs: 300,
  doubleTapMs: 350,
  palmMustFaceCamera: true,
  menuSelectMs: 500,
  menuSettleMs: 300,
  menuTimeoutMs: 5000,
  head: {},
  switchHandRatio: 1.25,
};

/** Profile for reduced mobility or tremor: slower, more tolerant gestures. */
export const REDUCED_MOBILITY_PROFILE: Partial<InteractionOptions> = {
  gestureHoldMs: 600,
  gestureStillness: 0.1,
  dwellMs: 1500,
  dwellRadius: 0.045,
  swipeDistance: 0.15,
  swipeWindowMs: 700,
  wakeMs: 1500,
  dragMs: 450,
  doubleTapMs: 500,
  menuSelectMs: 900,
  menuTimeoutMs: 8000,
};

type Listener = (e: HandEvent) => void;

interface MenuState {
  center: Point; // image coordinates, without aspect (for drawing)
  /** Hand that opened it: that hand's side cannot be chosen. */
  hand: HandSide | null;
  tOpened: number;
  /** Option currently under the pointer, and since when. */
  sector: MenuSector | null;
  tSector: number;
  /**
   * After reopening (submenu), the cell just chosen is ignored until the pointer leaves it, so the
   * option that sits there in the new page isn't chosen without moving.
   */
  blocked: MenuSector | null;
}

/** Raw measurements from the last frame, to show on screen and calibrate. */
export interface Diagnostics {
  /** On-screen thumb–index distance relative to hand size. */
  separation: number;
  /** Index reach (wrist→tip / wrist→knuckle). */
  reach: number;
  /** Thumb and index fingertips in the image. */
  thumb: Point;
  index: Point;
  /** Where the index points (from the user's point of view), if it clearly points somewhere. */
  indexDirection: MenuSector | null;
  /** Detected (stabilised) hand, or null if not clear yet. */
  hand: HandSide | null;
}

type ClickState = "idle" | "pressed" | "dragging" | "tapWait" | "secondPress";

/**
 * Why an open hand doesn't wake the detector: a finger isn't extended ("open"), the fingers are
 * bent ("straight") or together ("spread"), it's the back of the hand ("facing") or it is tilted
 * ("upright").
 */
export type WakeIssue = "open" | "straight" | "spread" | "facing" | "upright";

interface LevelState {
  /** Stepped value (0, 0.1, 0.2…). */
  value: number;
  /** Continuous, unrounded value (to show the position within the step). */
  continuous: number;
  /** Time of the last step change. */
  tChange: number;
  /** Whether the value has changed at least once (the untouched initial value is not confirmed). */
  moved: boolean;
  /** Recent values: when closing the fist, a value from before closing is used. */
  history: { t: number; value: number }[];
  tLastValid: number;
  thumb: Point;
  index: Point;
}

/** Events that count as activity (they keep the system awake). */
const ACTIVITY = new Set<HandEvent["type"]>(["gesture", "swipe", "select", "level", "menu", "head", "pointer", "mouse"]);

export class HandInteraction {
  private opts: InteractionOptions;
  private listeners = new Set<Listener>();
  private homography: number[] | null = null;

  // Presence
  private present = false;
  private tLastHand = -Infinity;

  // Stable gesture
  private stableGesture: Gesture = "none";
  private candidate: Gesture = "none";
  private tCandidate = 0;
  private candidatePos: Point = { x: 0, y: 0 };
  private currentPose: Gesture = "none";

  // Swipe
  private swipeHistory: { t: number; x: number; y: number }[] = [];
  private tLastSwipe = -Infinity;

  // Pointer
  private fx = new OneEuroFilter();
  private fy = new OneEuroFilter();
  private tLastPointer = -Infinity;
  private tLastPointing = -Infinity;
  private anchor: Point | null = null;
  private tAnchor = 0;
  private selectionDone = false;
  private lastPointer: Point | null = null;

  // Experimental
  private awake = true;
  private tActivity = 0;
  private tWakeStart: number | null = null;
  private wakePos: Point = { x: 0, y: 0 };
  private menu: MenuState | null = null;
  private diag: Diagnostics | null = null;
  /** Smoothed handedness vote: >0 right, <0 left. */
  private handVote = 0;
  private stableHand: HandSide | null = null;
  private tPinchStart: number | null = null;
  private level: LevelState | null = null;
  private fSeparation = new OneEuroFilter({ minCutoff: 1.0, beta: 0.3, derivativeCutoff: 1.0 });
  /** Volume armed from the menu, waiting for the fingers to touch (time it was armed). */
  private levelArmedAt: number | null = null;
  private levelTarget: LevelTarget = "volume";
  /** Cells the current menu offers (null: the cross, without the hand's side). */
  private menuCells: MenuSector[] | null = null;
  /** When the fist started inside the open menu (to close it by holding the fist). */
  private tMenuFist: number | null = null;
  private lastMenuCenter: Point | null = null;
  private lastChosenSector: MenuSector | null = null;
  private wakeIssue: WakeIssue | null = null;
  // Mouse buttons (click gesture).
  private click: ClickState = "idle";
  private clickTouching = false;
  private clickReady = false;
  private tClickPress = 0;
  private tClickRelease = 0;
  private headDetector: HeadGestureDetector;
  /** The hand being followed (its wrist position, to recognise it in the next frame). */
  private followed: { wrist: Point; hand: Hand } | null = null;

  constructor(options: Partial<InteractionOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.awake = !this.opts.requireWake;
    this.headDetector = new HeadGestureDetector(this.opts.head);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes options on the fly (e.g. enabling the reduced mobility profile). */
  configure(options: Partial<InteractionOptions>): void {
    const wakeBefore = this.opts.requireWake;
    const invertBefore = this.opts.invertHandedness;
    this.opts = { ...this.opts, ...options };
    if (options.head) this.headDetector = new HeadGestureDetector(this.opts.head);
    if (options.invertHandedness !== undefined && options.invertHandedness !== invertBefore) {
      this.handVote = -this.handVote;
      this.stableHand = this.stableHand && (this.stableHand === "right" ? "left" : "right");
    }
    if (wakeBefore !== this.opts.requireWake) this.awake = !this.opts.requireWake;
  }

  get options(): Readonly<InteractionOptions> {
    return this.opts;
  }

  /** Document corners in the image (provided by B1), or null if there is no document. */
  setDocument(corners: Corners | null): void {
    this.homography = corners ? documentHomography(corners) : null;
  }

  /** Pose detected in the last frame (not stabilised); useful for debugging. */
  get pose(): Gesture {
    return this.currentPose;
  }

  get gesture(): Gesture {
    return this.stableGesture;
  }

  get pointer(): Point | null {
    return this.lastPointer;
  }

  get isAwake(): boolean {
    return this.awake;
  }

  /** Progress [0,1] of the palm held to wake (to show a progress ring). */
  wakeProgress(t: number): number {
    if (this.awake || this.tWakeStart === null) return 0;
    return Math.min(1, (t - this.tWakeStart) / this.opts.wakeMs);
  }

  /** Open menu: option under the pointer and progress [0,1] until it is chosen. */
  menuOpen(t: number): { center: Point; sector: MenuSector | null; progress: number; hand: HandSide | null } | null {
    const m = this.menu;
    if (!m) return null;
    const progress = m.sector ? Math.min(1, (t - m.tSector) / this.opts.menuSelectMs) : 0;
    return { center: m.center, sector: m.sector, progress, hand: m.hand };
  }

  /**
   * Progress [0, 1] of the dwell selection (pointing still on one spot), to draw a ring that
   * fills up. 0 when not pointing, after the selection, or while the pointer moves.
   */
  dwellProgress(t: number): number {
    if (!this.anchor || this.selectionDone || t - this.tLastPointing > 150) return 0;
    return Math.min(1, Math.max(0, (t - this.tAnchor) / this.opts.dwellMs));
  }

  /** The hand currently being followed (the nearest one), or null. Useful to highlight it. */
  get activeHand(): Hand | null {
    return this.followed?.hand ?? null;
  }

  /** Hand the user is using (stabilised over several frames), or null if not clear. */
  get handInUse(): HandSide | null {
    return this.stableHand;
  }

  /**
   * Menu cells that can be chosen: the ones set with setMenuCells or, by default, the cross without
   * the current hand's side.
   */
  menuSectors(hand: HandSide | null = this.menu?.hand ?? this.stableHand): MenuSector[] {
    const all: MenuSector[] = ["up", "right", "down", "left", "up_left", "up_right", "down_left", "down_right"];
    return all.filter((s) => this.menuOffers(s, hand));
  }

  /** Raw measurements of the last frame with a hand (null if there is no hand). */
  get diagnostics(): Diagnostics | null {
    return this.diag;
  }

  /**
   * Active level control: stepped value, continuous value, progress [0,1] of the stillness
   * confirmation, and thumb and index fingertips (image) to draw the line.
   */
  levelActive(t: number): {
    value: number;
    continuous: number;
    confirmProgress: number;
    thumb: Point;
    index: Point;
  } | null {
    const n = this.level;
    if (!n) return null;
    const confirmProgress = n.moved ? Math.min(1, (t - n.tChange) / this.opts.levelConfirmMs) : 0;
    return { value: n.value, continuous: n.continuous, confirmProgress, thumb: n.thumb, index: n.index };
  }

  /**
   * Arms the volume control (called when "adjust volume" is chosen in the menu). From then on,
   * touching the thumb and index fingertips starts the adjustment. Otherwise the pinch does nothing.
   */
  startLevel(t: number = this.tLastHand, target: LevelTarget = "volume"): void {
    if (this.level) return;
    this.levelArmedAt = t;
    this.levelTarget = target;
    this.tPinchStart = null;
    this.lastPointer = null;
    this.emit({ type: "level", phase: "armed", value: 0, target, t });
  }

  /** What the current (or last) level control adjusts. */
  get levelTargetName(): LevelTarget {
    return this.levelTarget;
  }

  /**
   * Sets which cells the quick menu offers (for menus with more than 4 options, or submenus).
   * null goes back to the cross (up, right, down, left) without the side of the hand in use.
   */
  setMenuCells(cells: MenuSector[] | null): void {
    this.menuCells = cells;
  }

  /** Opens the menu again at the same place (e.g. to show a submenu after choosing an option). */
  reopenMenu(t: number = this.tLastHand): void {
    const hand = this.followed?.hand;
    if (!hand) return;
    this.openMenu(t, hand, 1, this.lastMenuCenter ?? undefined, this.lastChosenSector);
  }

  /** true while the volume is armed, waiting for the fingers to touch. */
  get levelArmed(): boolean {
    return this.levelArmedAt !== null;
  }

  /** Measure that is 0 % and measure that is 100 %. */
  get levelScale(): { zero: number; full: number } {
    return { zero: this.opts.levelZero, full: this.opts.levelFull };
  }

  /**
   * Guided calibration: measure with the fingers together and wide open. A small inward margin is
   * left so that 0 % and 100 % are reached without effort.
   */
  setLevelScale(together: number, open: number): void {
    const margin = 0.1 * (open - together);
    this.configure({ levelZero: together + margin, levelFull: open - margin });
  }

  process(frame: HandFrame): void {
    const { t } = frame;
    const aspect = frame.aspect ?? 1;

    this.processHead(t, frame);

    if (this.awake && this.opts.requireWake && t - this.tActivity > this.opts.sleepMs) {
      this.sleep(t);
    }

    const hand = this.pickHand(frame.hands, aspect, t);
    if (!hand) {
      this.currentPose = "none";
      this.diag = null;
      this.wakeIssue = null;
      if (this.present && t - this.tLastHand > this.opts.handLostMs) {
        this.present = false;
        this.releaseMouse(t);
        this.endLevel(t);
        this.cancelArmedLevel(t);
        this.closeMenu(t);
        this.resetTracking();
        if (this.stableGesture !== "none") {
          this.stableGesture = "none";
          this.emit({ type: "gesture", gesture: "none", t });
        }
        this.emit({ type: "hand", present: false, t });
      }
      return;
    }

    this.tLastHand = t;
    if (!this.present) {
      this.present = true;
      this.emit({ type: "hand", present: true, t });
    }

    let pose = classifyPose(hand, aspect, this.opts.thresholds);
    const backOfHand = pose === "palm" && palmFacesCamera(hand, this.sideOf(hand)) === false;
    if (backOfHand && this.opts.palmMustFaceCamera) pose = "none";
    const pts = shapePoints(hand, aspect);
    if (this.opts.mouseClicks && pose === "pinch") {
      // While clicking, the thumb comes close to the index too and the pose can read as a pinch:
      // with the index still straight (and ring and pinky folded) it is still pointing.
      const f = fingerState(pts, this.opts.thresholds);
      if (f.index && !f.ring && !f.pinky) pose = "point";
    }
    this.currentPose = pose;
    const center = palmCenter(hand, aspect);
    this.updateHandedness(hand);
    this.diag = {
      separation: screenSeparation(hand, aspect),
      reach: indexReach(pts),
      thumb: { x: hand.points[L.THUMB_TIP].x, y: hand.points[L.THUMB_TIP].y },
      index: { x: hand.points[L.INDEX_TIP].x, y: hand.points[L.INDEX_TIP].y },
      indexDirection: indexDirection(hand, aspect, this.opts.mirror),
      hand: this.stableHand,
    };

    if (!this.awake) {
      this.tryWake(t, pose, center, hand, aspect);
      if (backOfHand) this.wakeIssue = "facing";
      return;
    }
    if (this.menu) {
      this.updateMenu(t, pose, center, hand);
      return;
    }
    if (this.updateLevel(t, pose, center)) return;

    const swiped = this.detectSwipe(t, center, pose, aspect);
    if (!swiped) this.stabilizeGesture(t, pose, center, hand, aspect);
    this.updatePointer(t, hand, pose, aspect);
    if (this.opts.mouseClicks) this.updateClick(t, pose, hand, aspect);
  }

  // ---------- Stable gestures ----------

  private stabilizeGesture(t: number, pose: Gesture, center: Point, hand: Hand, aspect: number): void {
    if (t - this.tLastSwipe < this.opts.swipeCooldownMs) {
      // After a swipe the hand is still open: don't mistake it for "palm".
      this.resetCandidate(t, pose, center);
      return;
    }
    // The hand must be still so that a movement (e.g. a swipe) doesn't trigger gestures.
    // "point" is the exception: when pointing, the hand moves on purpose.
    const moved = pose !== "point" && distance2D(center, this.candidatePos) > this.opts.gestureStillness;
    if (pose !== this.candidate || moved) {
      this.resetCandidate(t, pose, center);
      return;
    }
    // The fist opens the menu, so it must be held a bit longer (passing through a fist while
    // changing gestures must not open it).
    const hold =
      this.candidate === "fist" ? Math.max(this.opts.gestureHoldMs, this.opts.menuHoldMs) : this.opts.gestureHoldMs;
    if (t - this.tCandidate >= hold && this.candidate !== this.stableGesture) {
      this.stableGesture = this.candidate;
      this.emit({ type: "gesture", gesture: this.stableGesture, t });
      if (this.stableGesture === "fist" && this.click === "idle") this.openMenu(t, hand, aspect);
    }
  }

  private resetCandidate(t: number, pose: Gesture, center: Point): void {
    this.candidate = pose;
    this.tCandidate = t;
    this.candidatePos = center;
  }

  // ---------- Swipe ----------

  private detectSwipe(t: number, center: Point, pose: Gesture, aspect: number): boolean {
    if (pose === "point" || pose === "pinch") {
      this.swipeHistory = [];
      return false;
    }
    // x is stored in width units (without aspect) to compare with swipeDistance.
    this.swipeHistory.push({ t, x: center.x / aspect, y: center.y });
    while (this.swipeHistory.length && t - this.swipeHistory[0].t > this.opts.swipeWindowMs) {
      this.swipeHistory.shift();
    }
    if (t - this.tLastSwipe < this.opts.swipeCooldownMs || this.swipeHistory.length < 3) return false;

    const first = this.swipeHistory[0];
    const dx = center.x / aspect - first.x;
    const dy = center.y - first.y;
    if (Math.abs(dx) < this.opts.swipeDistance || Math.abs(dy) > 0.6 * Math.abs(dx * aspect)) {
      return false;
    }
    // In the unmirrored image, when the user moves their hand to THEIR right, x decreases.
    const towardsImageRight = dx > 0;
    const direction = towardsImageRight !== this.opts.mirror ? "right" : "left";
    this.tLastSwipe = t;
    this.swipeHistory = [];
    this.emit({ type: "swipe", direction, t });
    return true;
  }

  // ---------- Pointer ----------

  private updatePointer(t: number, hand: Hand, pose: Gesture, aspect: number): void {
    if (pose === "point") this.tLastPointing = t;
    // Tolerate brief classification glitches while pointing.
    const pointing = t - this.tLastPointing <= 150;
    if (!pointing) {
      this.lastPointer = null;
      this.anchor = null;
      this.selectionDone = false;
      this.fx.reset();
      this.fy.reset();
      return;
    }

    const p = this.indexPointer(t, hand);
    this.lastPointer = p;
    const onDocument = this.toDocument(p);

    // With mouse clicks, the buttons come from the click gesture: no dwell selection. The pointer
    // stays put while the fingers tap (moving the middle finger shifts the index a little), so the
    // click lands where the user was pointing; it moves again when dragging.
    if (this.opts.mouseClicks) {
      const tapping = this.click === "pressed" || this.click === "tapWait" || this.click === "secondPress";
      if (!tapping && t - this.tLastPointer >= this.opts.pointerIntervalMs) {
        this.tLastPointer = t;
        this.emit({ type: "pointer", image: p, document: onDocument, t });
      }
      return;
    }

    // Dwell selection: the pointer stays still within a radius for a while.
    if (!this.anchor || distance2D(p, this.anchor, aspect) > this.opts.dwellRadius) {
      // To select again, the pointer must clearly leave the radius.
      if (!this.anchor || distance2D(p, this.anchor, aspect) > 2 * this.opts.dwellRadius) {
        this.selectionDone = false;
      }
      if (!this.selectionDone) {
        this.anchor = p;
        this.tAnchor = t;
      }
    } else if (!this.selectionDone && t - this.tAnchor >= this.opts.dwellMs) {
      this.selectionDone = true;
      this.emit({ type: "select", image: p, document: onDocument, t });
    }

    if (t - this.tLastPointer >= this.opts.pointerIntervalMs) {
      this.tLastPointer = t;
      this.emit({ type: "pointer", image: p, document: onDocument, t });
    }
  }

  private toDocument(p: Point): Point | null {
    if (!this.homography) return null;
    const d = applyHomography(this.homography, p);
    if (!d || d.x < 0 || d.x > 1 || d.y < 0 || d.y > 1) return null;
    return d;
  }

  // ---------- Experimental: sleep / wake ----------

  private tryWake(t: number, pose: Gesture, center: Point, hand: Hand, aspect: number): void {
    const still = distance2D(center, this.wakePos) <= this.opts.gestureStillness;
    if (pose !== "palm") this.wakeIssue = null;
    if (pose !== "palm" || !this.isWakePalm(hand, aspect)) {
      this.tWakeStart = null;
      return;
    }
    if (this.tWakeStart === null || !still) {
      this.tWakeStart = t;
      this.wakePos = center;
      return;
    }
    if (t - this.tWakeStart >= this.opts.wakeMs) this.wake(t, "palm");
  }

  /**
   * The wake palm is strict on purpose: all fingers clearly straight and spread, thumb out, the
   * palm (not the back) facing the camera, and the hand upright. A relaxed or half-open hand
   * while talking or gesturing doesn't count.
   */
  private isWakePalm(hand: Hand, aspect: number): boolean {
    this.wakeIssue = this.wakePalmIssue(hand, aspect);
    return this.wakeIssue === null;
  }

  /** What keeps an open hand from being a wake palm (null: it is one). */
  private wakePalmIssue(hand: Hand, aspect: number): WakeIssue | null {
    const pts = shapePoints(hand, aspect);
    const f = fingerState(pts, this.opts.thresholds);
    if (!(f.thumb && f.index && f.middle && f.ring && f.pinky)) return "open";
    const chains = [
      [L.INDEX_MCP, L.INDEX_PIP, L.INDEX_DIP, L.INDEX_TIP],
      [L.MIDDLE_MCP, L.MIDDLE_PIP, L.MIDDLE_DIP, L.MIDDLE_TIP],
      [L.RING_MCP, L.RING_PIP, L.RING_DIP, L.RING_TIP],
      [L.PINKY_MCP, L.PINKY_PIP, L.PINKY_DIP, L.PINKY_TIP],
    ];
    if (chains.some((c) => straightness(pts, c) < this.opts.wakeStraightness)) return "straight";
    if (distance(pts[L.INDEX_TIP], pts[L.PINKY_TIP]) / handSize(pts) < this.opts.wakeSpread) return "spread";
    if (palmFacesCamera(hand, this.sideOf(hand)) !== true) return "facing";
    // Upright: from the wrist to the middle knuckle, pointing up in the image.
    const w = hand.points[L.WRIST];
    const m = hand.points[L.MIDDLE_MCP];
    const tilt = (Math.atan2(Math.abs((m.x - w.x) * aspect), w.y - m.y) * 180) / Math.PI;
    return w.y > m.y && tilt <= this.opts.wakeUprightDeg ? null : "upright";
  }

  /**
   * While asleep: why the hand in view doesn't wake the detector yet, to tell the user (null: no
   * open hand in view, or it is a good wake palm).
   */
  get wakeHint(): WakeIssue | null {
    return this.awake ? null : this.wakeIssue;
  }

  private wake(t: number, currentPose: Gesture): void {
    this.awake = true;
    this.tWakeStart = null;
    this.tActivity = t;
    // The palm used to wake must not also trigger "pause".
    this.stableGesture = currentPose;
    this.candidate = currentPose;
    this.tCandidate = t;
    this.emit({ type: "mode", awake: true, t });
  }

  private sleep(t: number): void {
    this.awake = false;
    this.releaseMouse(t);
    this.endLevel(t);
    this.closeMenu(t);
    this.resetTracking();
    this.stableGesture = "none";
    this.emit({ type: "mode", awake: false, t });
  }

  // ---------- Experimental: pinch level ----------

  /**
   * Volume with the pinch (only after choosing "adjust volume" in the menu):
   * 1. It starts by touching the thumb and index fingertips into the 0 % zone (~0.15 s).
   * 2. The value is the thumb–index line measure between levelZero (0 %) and levelFull (100 %),
   *    rounded to 10 % steps.
   * 3. It is confirmed by holding still ~1 s on the same value (or closing the fist, with useFist).
   * Returns true if the frame was consumed by the volume control.
   */
  private updateLevel(t: number, pose: Gesture, center: Point): boolean {
    const diag = this.diag!;
    const together = diag.separation <= this.opts.levelZero && diag.reach >= this.opts.thresholds.indexOut;
    if (!this.level) {
      if (this.levelArmedAt === null) return false; // the pinch alone does nothing
      if (t - this.levelArmedAt > this.opts.levelArmMs) {
        this.cancelArmedLevel(t);
        return false;
      }
      if (!together) {
        this.tPinchStart = null;
        return true; // armed: other gestures wait
      }
      this.tPinchStart ??= t;
      if (t - this.tPinchStart < this.opts.levelStartMs) return true;
      this.tPinchStart = null;
      this.levelArmedAt = null;
      this.fSeparation.reset();
    } else if (this.opts.useFist && diag.reach < this.opts.fistReach) {
      // Fist: finish. Tolerate brief detection glitches.
      if (t - this.level.tLastValid <= 200) return true;
      this.endLevel(t, true);
      this.resetCandidate(t, pose, center);
      return false;
    }

    const sep = this.fSeparation.filter(diag.separation, t);
    const { levelZero, levelFull } = this.opts;
    const continuous = Math.min(1, Math.max(0, (sep - levelZero) / (levelFull - levelZero || 1)));
    const { thumb, index } = diag;
    this.lastPointer = null;

    if (!this.level) {
      const value = roundLevel(continuous, this.opts.levelStep);
      this.level = {
        value,
        continuous,
        tChange: t,
        moved: false,
        history: [{ t, value }],
        tLastValid: t,
        thumb,
        index,
      };
      this.emit({ type: "level", phase: "start", value, target: this.levelTarget, t });
      return true;
    }

    const n = this.level;
    n.continuous = continuous;
    n.thumb = thumb;
    n.index = index;
    n.tLastValid = t;
    // Hysteresis: only change step when clearly inside the next one.
    const step = this.opts.levelStep;
    if (Math.abs(continuous - n.value) > step * (0.5 + this.opts.levelHysteresis)) {
      n.value = roundLevel(continuous, step);
      n.tChange = t;
      n.moved = true;
      this.emit({ type: "level", phase: "move", value: n.value, target: this.levelTarget, t });
    }
    n.history.push({ t, value: n.value });
    while (n.history.length && t - n.history[0].t > 400) n.history.shift();

    // Confirm: held still on the same step for the configured time.
    if (n.moved && t - n.tChange >= this.opts.levelConfirmMs) {
      this.endLevel(t, false);
      this.stableGesture = pose;
      this.resetCandidate(t, pose, center);
    }
    return true;
  }

  private cancelArmedLevel(t: number): void {
    if (this.levelArmedAt === null) return;
    this.levelArmedAt = null;
    this.tPinchStart = null;
    this.emit({ type: "level", phase: "cancel", value: 0, target: this.levelTarget, t });
  }

  /** @param onClose true if it ends by closing the fist or losing the hand (an earlier value is used). */
  private endLevel(t: number, onClose = true): void {
    const n = this.level;
    if (!n) return;
    this.level = null;
    // When closing the hand, thumb and index move: keep the value from ~0.3 s before.
    const value = onClose
      ? (n.history.find((h) => h.t >= n.tLastValid - 300) ?? n.history[0])?.value ?? n.value
      : n.value;
    this.emit({ type: "level", phase: "end", value, target: this.levelTarget, t });
  }

  // ---------- Experimental: quick menu ----------

  private openMenu(t: number, hand: Hand, aspect: number, at?: Point, blocked: MenuSector | null = null): void {
    const c = palmCenter(hand, aspect);
    const center = at ?? { x: c.x / aspect, y: c.y };
    const menuHand = this.stableHand;
    this.menu = { center, hand: menuHand, tOpened: t, sector: null, tSector: t, blocked };
    this.lastMenuCenter = center;
    this.tMenuFist = null;
    this.lastPointer = null;
    this.emit({ type: "menu", phase: "open", sector: null, center, hand: menuHand, t });
  }

  /**
   * With the menu open, the user points with ☝️ and holds the pointer (the index tip) over an
   * option for ~0.5 s. Options fill screen zones in a cross (thirds): top-centre, bottom-centre,
   * left-centre and right-centre, as seen by the user.
   */
  private updateMenu(t: number, pose: Gesture, center: Point, hand: Hand): void {
    const m = this.menu!;
    if (t - m.tOpened > this.opts.menuTimeoutMs) {
      this.closeMenu(t);
      return;
    }
    if (t - m.tOpened < this.opts.menuSettleMs) return;

    // Holding the fist again closes the menu. The fist that opened it must be released first: only
    // a fist that starts after the menu opened counts.
    if (pose === "fist") {
      if (this.tMenuFist === null) this.tMenuFist = this.stableGesture === "fist" ? Infinity : t;
      if (t - this.tMenuFist >= this.opts.menuHoldMs) {
        this.closeMenu(t);
        this.stableGesture = "fist"; // released before it can open the menu again
        this.resetCandidate(t, pose, center);
        return;
      }
    } else {
      this.tMenuFist = null;
      if (this.stableGesture === "fist") this.stableGesture = pose;
    }

    // Only ☝️ moves the pointer (✊, which opens the menu, chooses nothing).
    if (pose === "point") this.tLastPointing = t;
    let sector: MenuSector | null = null;
    if (t - this.tLastPointing <= 150) {
      const p = this.indexPointer(t, hand);
      this.lastPointer = p;
      sector = screenSector(p, this.opts.mirror);
      if (m.blocked && sector === m.blocked) sector = null;
      else m.blocked = null; // the pointer left the cell chosen in the previous page
      if (sector && !this.menuOffers(sector, m.hand)) sector = null;
    } else {
      this.lastPointer = null;
      this.fx.reset();
      this.fy.reset();
    }

    if (sector !== m.sector) {
      m.sector = sector;
      m.tSector = t;
      this.emit({ type: "menu", phase: "highlight", sector, center: m.center, hand: m.hand, t });
      return;
    }
    if (sector && t - m.tSector >= this.opts.menuSelectMs) {
      this.menu = null;
      this.lastPointer = null;
      this.lastChosenSector = sector;
      // A listener may reopen the menu (a submenu) from inside this event.
      this.emit({ type: "menu", phase: "choose", sector, center: m.center, hand: m.hand, t });
      // The pose must change before "point" does anything else.
      this.stableGesture = pose;
      this.resetCandidate(t, pose, center);
      this.tLastPointing = -Infinity;
      this.anchor = null;
      this.selectionDone = true; // so the dwell doesn't also trigger a "select"
    }
  }

  /** Whether the open menu has an option in that cell. */
  private menuOffers(sector: MenuSector, hand: HandSide | null): boolean {
    if (this.menuCells) return this.menuCells.includes(sector);
    // Default: the cross, without the side of the hand in use (pointing outwards is awkward).
    return (sector === "up" || sector === "down" || sector === "left" || sector === "right") && sector !== hand;
  }

  // ---------- Mouse buttons (click gesture) ----------

  /**
   * Index pointing + middle fingertip touching the thumb tip = button pressed.
   * - short tap → "click" (sent after a short wait, in case a second tap follows);
   * - two quick taps → "right_click";
   * - held longer than dragMs → "down", and "up" when the fingers separate (drag).
   */
  private updateClick(t: number, pose: Gesture, hand: Hand, aspect: number): void {
    const pointing = pose === "point" || t - this.tLastPointing <= 150;
    const pts = shapePoints(hand, aspect);
    const size = handSize(pts);
    const gap = distance(pts[L.THUMB_TIP], pts[L.MIDDLE_TIP]) / size;
    // Pointing with the middle finger curled into the palm can leave its tip next to the thumb. Two
    // guards keep that from clicking: the fingers must first be seen apart after pointing starts
    // (clickReady), and the middle fingertip must be out in front of the palm, where it meets the
    // thumb, not tucked in near the wrist.
    if (!pointing) this.clickReady = false;
    else if (gap > this.opts.clickRelease) this.clickReady = true;
    const outInFront = distance(pts[L.WRIST], pts[L.MIDDLE_TIP]) / size >= this.opts.clickReach;
    this.clickTouching =
      pointing &&
      (this.clickTouching ? gap < this.opts.clickRelease : this.clickReady && outInFront && gap < this.opts.clickPress);
    const touching = this.clickTouching;

    switch (this.click) {
      case "idle":
        if (touching) {
          this.click = "pressed";
          this.tClickPress = t;
        }
        break;
      case "pressed":
        if (!touching) {
          this.click = "tapWait";
          this.tClickRelease = t;
        } else if (t - this.tClickPress >= this.opts.dragMs) {
          this.click = "dragging";
          this.emitMouse("down", t);
        }
        break;
      case "dragging":
        if (!touching) {
          this.click = "idle";
          this.emitMouse("up", t);
        }
        break;
      case "tapWait":
        if (touching) {
          this.click = "secondPress";
          this.emitMouse("right_click", t);
        } else if (t - this.tClickRelease > this.opts.doubleTapMs) {
          this.click = "idle";
          this.emitMouse("click", t);
        }
        break;
      case "secondPress":
        if (!touching) this.click = "idle";
        break;
    }
  }

  /** Lets go of the mouse button if it was held (hand lost, sleeping…). */
  private releaseMouse(t: number): void {
    if (this.click === "dragging") this.emitMouse("up", t);
    else if (this.click === "tapWait") this.emitMouse("click", t);
    this.click = "idle";
    this.clickTouching = false;
    this.clickReady = false;
  }

  private emitMouse(action: MouseAction, t: number): void {
    this.emit({ type: "mouse", action, t });
  }

  /** Mouse button state, for drawing: "pressed" or "dragging" while the fingers touch. */
  get mouseButton(): "up" | "pressed" | "dragging" {
    return this.click === "dragging" ? "dragging" : this.clickTouching ? "pressed" : "up";
  }

  /** Index fingertip (slightly ahead), filtered against tremor. */
  private indexPointer(t: number, hand: Hand): Point {
    const tip = hand.points[L.INDEX_TIP];
    const dip = hand.points[L.INDEX_DIP];
    return {
      x: this.fx.filter(tip.x + (tip.x - dip.x) * this.opts.pointerLead, t),
      y: this.fy.filter(tip.y + (tip.y - dip.y) * this.opts.pointerLead, t),
    };
  }

  private closeMenu(t: number): void {
    if (!this.menu) return;
    const { center, hand } = this.menu;
    this.menu = null;
    this.emit({ type: "menu", phase: "close", sector: null, center, hand, t });
  }

  // ---------- Experimental: head ----------

  private processHead(t: number, frame: HandFrame): void {
    if (frame.face === undefined) return; // face detection disabled
    const g = this.headDetector.process(t, frame.face);
    if (!g) return;
    if (!this.awake) {
      // For people who can't use their hands: nodding also wakes.
      if (g === "nod") this.wake(t, this.currentPose);
      return;
    }
    this.emit({ type: "head", gesture: g, t });
  }

  // ---------- Hand in use ----------

  /** This frame's hand: the stabilised one if available; otherwise this frame's own label. */
  private sideOf(hand: Hand): HandSide | null {
    if (this.stableHand) return this.stableHand;
    if (hand.handedness !== "Left" && hand.handedness !== "Right") return null;
    return (hand.handedness === "Right") !== this.opts.invertHandedness ? "right" : "left";
  }

  /** Smoothed vote: one mislabelled frame doesn't change the hand. */
  private updateHandedness(hand: Hand): void {
    const label = hand.handedness;
    if (label !== "Left" && label !== "Right") return;
    const isRight = (label === "Right") !== this.opts.invertHandedness;
    const weight = hand.score ?? 0.5;
    this.handVote = 0.9 * this.handVote + 0.1 * (isRight ? weight : -weight);
    if (this.handVote > 0.3) this.stableHand = "right";
    else if (this.handVote < -0.3) this.stableHand = "left";
  }

  // ---------- Several hands: follow the nearest ----------

  /**
   * Picks the hand to follow: the nearest one (largest in the image). The current hand is kept
   * unless another one is clearly nearer, and switching hands resets the gesture in progress.
   */
  private pickHand(hands: Hand[], aspect: number, t: number): Hand | null {
    const valid = hands.filter((h) => h.points.length === 21);
    if (valid.length === 0) {
      this.followed = null;
      return null;
    }
    let nearest = valid[0];
    for (const h of valid) if (handExtent(h, aspect) > handExtent(nearest, aspect)) nearest = h;

    let chosen = nearest;
    const prev = this.followed;
    if (prev) {
      // The same hand as last frame: the one whose wrist is closest to where it was.
      let same: Hand | null = null;
      let best = Infinity;
      for (const h of valid) {
        const d = distance2D(h.points[L.WRIST], prev.wrist, aspect);
        if (d < best) {
          best = d;
          same = h;
        }
      }
      const stillThere = same && best < 0.5 * handExtent(same, aspect);
      if (stillThere && handExtent(nearest, aspect) < this.opts.switchHandRatio * handExtent(same!, aspect)) {
        chosen = same!;
      }
      if (!stillThere || chosen !== same) {
        // Another hand (or person) takes over: start fresh.
        this.resetTracking();
        this.endLevel(t);
        this.handVote = 0;
        this.stableHand = null;
      }
    }
    this.followed = { wrist: { x: chosen.points[L.WRIST].x, y: chosen.points[L.WRIST].y }, hand: chosen };
    return chosen;
  }

  // ---------- Utilities ----------

  private resetTracking(): void {
    this.candidate = "none";
    this.swipeHistory = [];
    this.tLastPointing = -Infinity;
    this.lastPointer = null;
    this.anchor = null;
    this.selectionDone = false;
    this.tWakeStart = null;
    this.fx.reset();
    this.fy.reset();
  }

  private emit(e: HandEvent): void {
    if (ACTIVITY.has(e.type)) this.tActivity = e.t;
    for (const l of this.listeners) l(e);
  }
}

/** Size of the hand in the image (bounding-box diagonal): larger means nearer the camera. */
export function handExtent(hand: Hand, aspect = 1): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of hand.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return Math.hypot((maxX - minX) * aspect, maxY - minY);
}

/**
 * Where the index finger points (from its knuckle to its tip), from the user's point of view.
 * null if the finger points diagonally or towards the camera (the direction is unclear).
 */
export function indexDirection(hand: Hand, aspect: number, mirror: boolean): MenuSector | null {
  const base = hand.points[L.INDEX_MCP];
  const tip = hand.points[L.INDEX_TIP];
  const dxImage = (tip.x - base.x) * aspect;
  const dx = mirror ? -dxImage : dxImage;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy);
  // A finger pointing at the camera looks very short in the image.
  const palm = distance2D(hand.points[L.WRIST], hand.points[L.INDEX_MCP], aspect) || 1;
  if (length < 0.35 * palm) return null;
  if (Math.abs(dx) > 1.3 * Math.abs(dy)) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > 1.3 * Math.abs(dx)) return dy > 0 ? "down" : "up";
  return null;
}

/**
 * Does the palm (not the back of the hand) face the camera? In the unmirrored image, on a right
 * hand with the palm towards the camera the index sits on the image's right and the pinky on its
 * left; on a left hand, the other way round. The sign of the cross product wrist→index ×
 * wrist→pinky tells which (and it doesn't change when the hand rotates in the image plane).
 * null if the hand is unknown.
 */
export function palmFacesCamera(hand: Hand, side: HandSide | null): boolean | null {
  if (!side) return null;
  const w = hand.points[L.WRIST];
  const i = hand.points[L.INDEX_MCP];
  const k = hand.points[L.PINKY_MCP];
  const cross = (i.x - w.x) * (k.y - w.y) - (i.y - w.y) * (k.x - w.x);
  return side === "right" ? cross < 0 : cross > 0;
}

/**
 * On-screen distance between the thumb and index fingertips, divided by the hand's on-screen size
 * (wrist → middle knuckle). It is exactly the line drawn on screen.
 */
export function screenSeparation(hand: Hand, aspect: number): number {
  const p = hand.points;
  const size = distance2D(p[L.WRIST], p[L.MIDDLE_MCP], aspect) || 1;
  return distance2D(p[L.THUMB_TIP], p[L.INDEX_TIP], aspect) / size;
}

const GRID: (MenuSector | null)[][] = [
  ["up_left", "up", "up_right"],
  ["left", null, "right"],
  ["down_left", "down", "down_right"],
];

/**
 * Menu cell under the pointer: the screen (as seen by the user) is split into a 3×3 grid with an
 * empty centre. Each menu decides which cells it uses (setMenuCells).
 */
export function screenSector(p: Point, mirror: boolean): MenuSector | null {
  const x = mirror ? 1 - p.x : p.x;
  const col = Math.floor(Math.min(0.999, Math.max(0, x)) * 3);
  const row = Math.floor(Math.min(0.999, Math.max(0, p.y)) * 3);
  return GRID[row][col];
}

function roundLevel(v: number, step: number): number {
  return Math.min(1, Math.max(0, Number((Math.round(v / step) * step).toFixed(4))));
}

/** Palm centre in the image, with x corrected by aspect (image-height units). */
function palmCenter(hand: Hand, aspect: number): Point {
  const c = mean(
    [L.WRIST, L.INDEX_MCP, L.MIDDLE_MCP, L.RING_MCP, L.PINKY_MCP].map((i) => hand.points[i]),
  );
  return { x: c.x * aspect, y: c.y };
}

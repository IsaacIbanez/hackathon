// Entry point of the hand module (role C). Typical use:
//
//   const interaction = new HandInteraction();
//   interaction.on((e) => { const a = actionFor(e, "document"); if (a) send(a, e); });
//   await createTracker(video, (f) => interaction.process(f));
//   interaction.setDocument(cornersFromB1);

export * from "./types.ts";
export {
  HandInteraction,
  DEFAULT_OPTIONS,
  REDUCED_MOBILITY_PROFILE,
  indexDirection,
  screenSector,
  screenSeparation,
  palmFacesCamera,
  type Diagnostics,
  type InteractionOptions,
} from "./interaction.ts";
export { actionFor, MAPS, QUICK_MENU, menuFor, type Action, type Context } from "./actions.ts";
export { classifyPose, fingerState } from "./poses.ts";
export { HeadGestureDetector } from "./head.ts";
export { createTracker, type Tracker, type TrackerOptions } from "./tracker.ts";

// Standalone Gesture Control page, served by the helper (go run ./adapters/desktop) with its token.
import { HelperClient } from "./client.ts";
import { mountGestureControl } from "./gestureControl.ts";

const token = document.querySelector<HTMLMetaElement>('meta[name="gesture-token"]')?.content ?? "";
mountGestureControl(document.getElementById("gc-root")!, new HelperClient(token));

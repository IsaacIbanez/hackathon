// Standalone Gesture Control page, served by the helper (go run ./adapters/desktop) with its token.
// Halo's typeface, from the package (works offline), as in the overlay's index.css.
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { HelperClient } from "./client.ts";
import { mountGestureControl } from "./gestureControl.ts";

const token = document.querySelector<HTMLMetaElement>('meta[name="gesture-token"]')?.content ?? "";
mountGestureControl(document.getElementById("gc-root")!, new HelperClient(token));

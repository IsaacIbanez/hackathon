// Short beeps so the user knows when the app starts and stops listening (important without sight).

let ctx: AudioContext | null = null;

export type Earcon = "start" | "end" | "error";

const TONES: Record<Earcon, [number, number][]> = {
  start: [[660, 90], [880, 110]],
  end: [[880, 90], [660, 110]],
  error: [[300, 220]],
};

export function beep(kind: Earcon, volume = 0.15): void {
  if (typeof AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    // Started from a keypad key (an event from Go, not a click) it may be suspended: no sound.
    if (ctx.state === "suspended") void ctx.resume();
    let t = ctx.currentTime;
    for (const [freq, ms] of TONES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + ms / 1000);
      t += ms / 1000;
    }
  } catch {
    // Audio feedback is a nice-to-have: never break the flow because of it.
  }
}

// Short "photo taken" sound, in the style of the voice earcons in src/input/voice/earcons.ts
// (that module only has start/end/error; this one is owned by the camera module).

let ctx: AudioContext | null = null

const TONES: [number, number][] = [
  [1320, 60],
  [1760, 90],
]

export function shutterBeep(volume = 0.15): void {
  if (typeof AudioContext === 'undefined') return
  try {
    ctx ??= new AudioContext()
    let t = ctx.currentTime
    for (const [freq, ms] of TONES) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(volume, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + ms / 1000)
      t += ms / 1000
    }
  } catch {
    // Audio feedback is a nice-to-have: never break the capture because of it.
  }
}

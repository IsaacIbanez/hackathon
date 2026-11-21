// Live microphone level (0–1), so the user can see that the app hears them while it listens.

/** Starts measuring the microphone; calls onLevel about 30 times a second. Returns a stop function. */
export async function watchMicLevel(onLevel: (level: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 1024;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let stopped = false;
  let smooth = 0;
  const timer = setInterval(() => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    // Speech is roughly 0.02–0.2 RMS: map it to 0–1 and smooth so the bar doesn't flicker.
    const level = Math.min(1, rms * 6);
    smooth = Math.max(level, smooth * 0.85);
    onLevel(smooth);
  }, 33);
  return () => {
    stopped = true;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void audio.close();
  };
}

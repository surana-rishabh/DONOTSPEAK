export type SpeechActivity = { voicedMs: number; lastVoice: number; lastSample: number };

export function sampleSpeech(activity: SpeechActivity, rms: number, now: number) {
  const elapsed = Math.min(100, Math.max(0, now - activity.lastSample));
  activity.lastSample = now;
  // shortcut: energy-based VAD; calibrate on target devices before adding a heavier speech detector.
  if (rms >= 0.018) { activity.voicedMs += elapsed; activity.lastVoice = now; }
  else if (activity.voicedMs < 180 && now - activity.lastVoice >= 900) activity.voicedMs = 0;
  return activity.voicedMs >= 180 && now - activity.lastVoice >= 900;
}

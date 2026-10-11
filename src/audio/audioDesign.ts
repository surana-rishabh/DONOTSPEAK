export type AudioPhase = "onboarding" | "briefing" | "active" | "resolving" | "panel" | "ended";
export type SuspenseMix = { drone: number; buzz: number; pulse: number; noise: number; music: number; impactRate: number };

export function mixForTension(danger: number, mimicVisible: boolean, phase: AudioPhase, ducked: boolean): SuspenseMix {
  const phaseBoost = phase === "ended" ? 0.3 : phase === "resolving" ? 0.12 : 0;
  const tension = Math.min(1, Math.max(0, danger / 10 + (mimicVisible ? 0.25 : 0) + phaseBoost));
  const duck = ducked ? 0.28 : 1;
  return {
    drone: (0.11 + tension * 0.11) * duck,
    buzz: (0.025 + tension * 0.06) * duck,
    pulse: (0.012 + tension * 0.15) * duck,
    noise: (0.018 + tension * 0.1) * duck,
    music: (0.026 + tension * 0.014) * duck,
    impactRate: (0.01 + tension * 0.18) * duck
  };
}

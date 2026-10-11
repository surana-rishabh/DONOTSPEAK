export type RoomPoint = readonly [number, number, number];
export type ScareKind = "mimic" | "caller";
export type ScareState = { phase: string; mimicVisible: boolean };

export function buildSafeRoute(from: RoomPoint, to: RoomPoint): RoomPoint[] {
  const clampX = (value: number) => Math.max(-4.6, Math.min(4.6, value));
  const corridorZ = 1.35;
  return [
    [clampX(from[0]), 0, corridorZ],
    [clampX(to[0]), 0, corridorZ],
    [to[0], to[1], to[2]]
  ];
}

export function scareTransition(previous: ScareState | null, next: ScareState, reducedMotion: boolean): ScareKind | null {
  if (!previous || reducedMotion) return null;
  if (previous.phase !== "ended" && next.phase === "ended") return "caller";
  if (!previous.mimicVisible && next.mimicVisible) return "mimic";
  return null;
}

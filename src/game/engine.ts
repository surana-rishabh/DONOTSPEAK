import { z } from "zod";
import { LearnedConceptSchema, type CallBlueprint, type LearnedConcept, type Outcome, type TurnResolution, type WorldSnapshot } from "../../shared/contracts.js";
import { guardTurn, localTurn, parseInstruction, STATION_POSITIONS, type Language } from "../../shared/rules.js";
import { ENTITY_IDS, FALLBACK_CALLS, GOLDEN_CALL } from "./catalog.js";
export { extractConcepts } from "../../shared/rules.js";

export type MicMode = "push" | "live" | "muted";
export type GamePhase = "onboarding" | "briefing" | "active" | "resolving" | "panel" | "ended";
export type LogEntry = { id: string; type: "system" | "caller" | "mimic" | "danger" | "report"; text: string };
export type GameState = {
  phase: GamePhase; language: Language; steps: string[]; signalChecked: boolean;
  operatorCodename: string; callId: string; callIndex: number; blueprint: CallBlueprint; prologueBeat: number;
  danger: number; microphoneMode: MicMode; callerPosition: WorldSnapshot["callerPosition"];
  callerCoords?: [number, number, number]; mimicCoords?: [number, number, number]; mimicPosition?: WorldSnapshot["callerPosition"];
  doorsOpen: boolean; powerOn: boolean; mimicVisible: boolean; awaitingSilence: boolean; cameraIndex: number;
  vocabulary: LearnedConcept[]; score: number; survivors: number; silenceStreak: number;
  lastTranscript: string; partialTranscript: string; caption: string; interpretation: string;
  outcome: Outcome | null; degraded: boolean; log: LogEntry[];
};
const STORAGE_KEY = "do-not-say-it.shift.v2";
const SavedSchema = z.object({ vocabulary: z.array(LearnedConceptSchema).max(12), score: z.number().int().min(0), survivors: z.number().int().min(0), callIndex: z.number().int().min(0).max(9999) });
const id = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
function loadProgress() {
  const empty = { vocabulary: [], score: 0, survivors: 0, callIndex: 0 };
  try {
    if (typeof localStorage === "undefined") return empty;
    const value = SavedSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    return value.success ? value.data : empty;
  } catch { return empty; }
}
export function persistProgress(state: GameState) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify({ vocabulary: state.vocabulary, score: state.score, survivors: state.survivors, callIndex: state.callIndex })); } catch { /* Private browsing must not break a turn. */ }
}
export function clearProgress() {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}
export function createInitialState(): GameState {
  return { ...loadProgress(), phase: "onboarding", language: "en", steps: [], signalChecked: false,
    operatorCodename: "NIGHTJAR", callId: "prologue", blueprint: GOLDEN_CALL, prologueBeat: 0, danger: 0,
    microphoneMode: "push", callerPosition: "center", callerCoords: [...STATION_POSITIONS.center],
    mimicCoords: [2.4, 0, -1.8], mimicPosition: "mirror", doorsOpen: false, powerOn: true, mimicVisible: false,
    awaitingSilence: false, cameraIndex: 0, silenceStreak: 0, lastTranscript: "", partialTranscript: "",
    caption: "", interpretation: "", outcome: null, degraded: false, log: [] };
}
export function openingLine(state: GameState) {
  return state.language === "hi" ? "कंट्रोल? मैं यहाँ फँसी हूँ। मुझे धीरे-धीरे दिशा दें। वह आपकी बातें सुन रहा है।" : state.blueprint.openingLine;
}
export function startGoldenCall(state: GameState, codename: string): GameState {
  return { ...createInitialState(), language: state.language, score: state.score, survivors: state.survivors,
    vocabulary: state.vocabulary, phase: "briefing", operatorCodename: codename.trim() || "NIGHTJAR", caption: GOLDEN_CALL.openingLine };
}
export function beginCall(state: GameState): GameState {
  return { ...state, phase: "active", caption: openingLine(state), log: [{ id: id(), type: "caller", text: openingLine(state) }] };
}
export const withPartial = (state: GameState, partialTranscript: string): GameState => ({ ...state, partialTranscript });
export const markResolving = (state: GameState, transcript: string): GameState => ({ ...state, phase: "resolving", lastTranscript: transcript, partialTranscript: "" });
export function snapshot(state: GameState): WorldSnapshot {
  return { language: state.language, steps: state.steps, signalChecked: state.signalChecked,
    callId: state.callId, callIndex: state.callIndex, prologueBeat: state.prologueBeat, danger: state.danger,
    microphoneMode: state.microphoneMode, callerPosition: state.callerPosition, callerCoords: state.callerCoords, mimicCoords: state.mimicCoords,
    doorsOpen: state.doorsOpen, powerOn: state.powerOn, mimicVisible: state.mimicVisible, awaitingSilence: false,
    operatorCodename: state.operatorCodename, vocabulary: state.vocabulary.map((c) => c.concept),
    visibleEntityIds: ENTITY_IDS.filter((entity) => entity !== "mimic" || state.mimicVisible), objective: state.blueprint.objective };
}
export const fallbackResolution = (state: GameState, transcript: string) => localTurn(snapshot(state), transcript);

export function applyResolution(state: GameState, raw: TurnResolution, degraded = false): GameState {
  if (state.phase === "ended" || state.phase === "onboarding" || state.phase === "briefing") return state;
  const result = guardTurn(raw, snapshot(state), state.lastTranscript);
  const instruction = parseInstruction(state.lastTranscript, snapshot(state));
  let next = { ...state, phase: "active" as GamePhase, degraded, interpretation: result.interpretation, caption: result.response.text };
  for (const mutation of result.mutations) {
    if (mutation.kind === "move_actor" && mutation.targetId === "caller" && typeof mutation.value === "string" && mutation.value in STATION_POSITIONS) {
      next.callerPosition = mutation.value as GameState["callerPosition"];
      next.callerCoords = [...STATION_POSITIONS[next.callerPosition]];
    }
    if (mutation.kind === "open") next.doorsOpen = true;
    if (mutation.kind === "close") next.doorsOpen = false;
    if (mutation.kind === "power_on") next.powerOn = true;
    if (mutation.kind === "power_off") next.powerOn = false;
  }
  const fresh = result.learnedConcepts.filter((c) => !state.vocabulary.some((known) => known.concept === c.concept));
  next.vocabulary = [...state.vocabulary, ...fresh];
  next.danger = Math.min(10, state.danger + fresh.reduce((sum, c) => sum + c.severity, 0));
  next.mimicVisible = state.mimicVisible || next.danger >= 4;
  const hi = state.language === "hi";
  const objective = state.blueprint.objective;
  const steps = new Set(state.steps);
  const atDoor = ["door", "threshold", "exit"].includes(next.callerPosition);
  if (objective === "escape") {
    if (atDoor) steps.add("reach");
    if (steps.has("reach") && next.doorsOpen) steps.add("act");
    if (steps.has("act") && atDoor && next.doorsOpen && instruction.confirm) steps.add("confirm");
  } else if (objective === "restore_power") {
    if (next.callerPosition === "utility") steps.add("reach");
    if (steps.has("reach") && next.powerOn && result.mutations.some((m) => m.kind === "power_on")) steps.add("act");
    if (steps.has("act") && next.callerPosition === "utility" && next.powerOn && instruction.confirm) steps.add("confirm");
  } else if (objective === "identify_caller") {
    if (next.callerPosition === "observation") steps.add("reach");
    if (next.callerPosition === "observation" && instruction.kind === "inspect") {
      steps.add("act"); next.signalChecked = true;
      next.caption = state.callIndex % 2 === 0
        ? hi ? "सिग्नल आपकी पिछली बात हूबहू दोहरा रहा है। साँस की कोई आवाज़ नहीं है।" : "The signal repeats your last sentence exactly. There is no breathing."
        : hi ? "हर जवाब अलग है। सिग्नल में साँस और धड़कन सुनाई देती है।" : "Each response is different. The signal carries breathing and a heartbeat.";
    }
    if (steps.has("act") && next.callerPosition === "observation" && instruction.verdict) {
      if (instruction.verdict === (state.callIndex % 2 === 0 ? "contain" : "trust")) steps.add("confirm");
      else next.outcome = "identity_stolen";
    }
  } else {
    if (next.callerPosition === "stairwell") steps.add("reach");
    if (next.callerPosition === "stairwell" && instruction.kind === "wait" && /^(wait|stay|रुको|रुकें|ruko)/iu.test(state.lastTranscript.trim())) {
      steps.add("act"); next.mimicVisible = true; next.mimicPosition = "stairwell";
      next.caption = hi ? "वह निशान के भीतर आ गया। अब क्षेत्र सील करें।" : "It followed me inside the marker. Seal the area now.";
    }
    if (steps.has("act") && next.callerPosition === "stairwell" && instruction.operation === "seal") steps.add("confirm");
  }
  next.steps = [...steps];
  if (next.danger >= 10) next.outcome = "caught";
  else if (steps.has("confirm") && !next.outcome) next.outcome = "escaped";
  if (next.outcome) {
    next.phase = "ended"; next.microphoneMode = "muted";
    if (next.outcome === "escaped") {
      next.score += 250 + (10 - next.danger) * 10; next.survivors += 1;
      next.caption = hi ? "सिग्नल सुरक्षित है। आपकी सावधानी काम आई।" : "The signal is secure. Your careful instructions worked.";
    }
  }
  if (fresh.length && !next.outcome) next.caption += hi ? ` उसने ${fresh.length} नया शब्द सीख लिया।` : ` It learned ${fresh.length} new ${fresh.length === 1 ? "word" : "words"}.`;
  next.log = [{ id: id(), type: "caller", text: next.caption }, ...fresh.map((c) => ({ id: id(), type: "danger" as const, text: `${c.concept} +${c.severity}` })), ...state.log].slice(0, 16);
  persistProgress(next);
  return next;
}
export function sealBySilence(state: GameState): GameState { return state; }
export function startGeneratedCall(state: GameState, blueprint?: CallBlueprint): GameState {
  const callIndex = Math.min(9999, state.callIndex + 1);
  const selected = blueprint || FALLBACK_CALLS[(callIndex - 1) % FALLBACK_CALLS.length];
  const next: GameState = { ...createInitialState(), language: state.language, operatorCodename: state.operatorCodename,
    score: state.score, survivors: state.survivors, vocabulary: state.vocabulary, phase: "briefing", callIndex,
    callId: `${selected.seed}-${callIndex}`, blueprint: selected, powerOn: selected.objective !== "restore_power", degraded: !blueprint };
  next.caption = openingLine(next); persistProgress(next); return next;
}
export function updateCallerCoords(state: GameState, coords: [number, number, number]): GameState {
  return { ...state, callerCoords: coords };
}

import type { CallBlueprint, LearnedConcept, Mutation, Outcome, TurnResolution, WorldSnapshot } from "../../shared/contracts.js";
import { CONCEPT_POWERS, ENTITY_IDS, FALLBACK_CALLS, GOLDEN_CALL } from "./catalog.js";

export type MicMode = "push" | "live" | "muted";
export type GamePhase = "onboarding" | "briefing" | "active" | "resolving" | "panel" | "ended";

export type LogEntry = { id: string; type: "system" | "caller" | "mimic" | "danger" | "report"; text: string };

export type GameState = {
  phase: GamePhase;
  operatorCodename: string;
  callId: string;
  callIndex: number;
  blueprint: CallBlueprint;
  prologueBeat: number;
  danger: number;
  microphoneMode: MicMode;
  callerPosition: WorldSnapshot["callerPosition"];
  callerCoords?: [number, number, number];
  mimicCoords?: [number, number, number];
  mimicPosition?: WorldSnapshot["callerPosition"];
  doorsOpen: boolean;
  powerOn: boolean;
  mimicVisible: boolean;
  awaitingSilence: boolean;
  cameraIndex: number;
  vocabulary: LearnedConcept[];
  score: number;
  survivors: number;
  silenceStreak: number;
  lastTranscript: string;
  partialTranscript: string;
  caption: string;
  interpretation: string;
  outcome: Outcome | null;
  degraded: boolean;
  log: LogEntry[];
};

const STORAGE_KEY = "do-not-say-it.shift.v1";

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function loadProgress(): Pick<GameState, "vocabulary" | "score" | "survivors" | "callIndex"> {
  if (typeof localStorage === "undefined") return { vocabulary: [], score: 0, survivors: 0, callIndex: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<GameState> | null;
    return {
      vocabulary: Array.isArray(value?.vocabulary) ? value.vocabulary.slice(0, 64) : [],
      score: Number.isFinite(value?.score) ? Number(value?.score) : 0,
      survivors: Number.isFinite(value?.survivors) ? Number(value?.survivors) : 0,
      callIndex: Number.isFinite(value?.callIndex) ? Number(value?.callIndex) : 0
    };
  } catch {
    return { vocabulary: [], score: 0, survivors: 0, callIndex: 0 };
  }
}

export function persistProgress(state: GameState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    vocabulary: state.vocabulary,
    score: state.score,
    survivors: state.survivors,
    callIndex: state.callIndex
  }));
}

export function clearProgress() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
}

export function createInitialState(): GameState {
  const saved = loadProgress();
  return {
    phase: "onboarding",
    operatorCodename: "",
    callId: "prologue",
    callIndex: saved.callIndex,
    blueprint: GOLDEN_CALL,
    prologueBeat: 0,
    danger: 0,
    microphoneMode: "push",
    callerPosition: "center",
    callerCoords: [0, 0, 0.8],
    mimicCoords: [2.4, 0, -1.8],
    mimicPosition: "mirror",
    doorsOpen: false,
    powerOn: true,
    mimicVisible: false,
    awaitingSilence: false,
    cameraIndex: 0,
    vocabulary: saved.vocabulary,
    score: saved.score,
    survivors: saved.survivors,
    silenceStreak: 0,
    lastTranscript: "",
    partialTranscript: "",
    caption: "The Department is waiting.",
    interpretation: "",
    outcome: null,
    degraded: false,
    log: []
  };
}

export function startGoldenCall(state: GameState, codename: string): GameState {
  return {
    ...state,
    phase: "briefing",
    operatorCodename: codename.trim().slice(0, 24) || "NIGHTJAR",
    callId: "prologue",
    callIndex: 0,
    blueprint: GOLDEN_CALL,
    prologueBeat: 0,
    danger: 0,
    microphoneMode: "push",
    callerPosition: "center",
    callerCoords: [0, 0, 0.8],
    mimicCoords: [2.4, 0, -1.8],
    mimicPosition: "mirror",
    doorsOpen: false,
    powerOn: true,
    mimicVisible: false,
    awaitingSilence: false,
    outcome: null,
    log: [{ id: id(), type: "system", text: GOLDEN_CALL.operatorNotice }]
  };
}

export function beginCall(state: GameState): GameState {
  return {
    ...state,
    phase: "active",
    caption: state.blueprint.openingLine,
    log: [{ id: id(), type: "caller", text: state.blueprint.openingLine }, ...state.log]
  };
}

export function withPartial(state: GameState, partialTranscript: string): GameState {
  return { ...state, partialTranscript };
}

export function markResolving(state: GameState, transcript: string): GameState {
  return {
    ...state,
    phase: "resolving",
    lastTranscript: transcript,
    partialTranscript: "",
    interpretation: "Compiling speech against the visible room…"
  };
}

export function extractConcepts(transcript: string): LearnedConcept[] {
  const words: string[] = [...(transcript.toLowerCase().match(/[a-z']+/g) ?? [])];
  return Object.entries(CONCEPT_POWERS)
    .filter(([concept]) => words.includes(concept))
    .map(([concept, power]) => ({ concept, ...power }));
}

function uniqueConcepts(existing: LearnedConcept[], incoming: LearnedConcept[]) {
  const map = new Map(existing.map((item) => [item.concept, item]));
  for (const item of incoming) map.set(item.concept, item);
  return [...map.values()].slice(0, 64);
}

function applyMutation(state: GameState, mutation: Mutation): GameState {
  switch (mutation.kind) {
    case "open":
      return mutation.targetId === "red_door" || mutation.targetId === "exit" ? { ...state, doorsOpen: true } : state;
    case "close":
      return mutation.targetId === "red_door" || mutation.targetId === "exit" ? { ...state, doorsOpen: false } : state;
    case "power_on":
      return mutation.targetId === "red_lamp" || mutation.targetId === "utility" ? { ...state, powerOn: true } : state;
    case "power_off":
    case "camera_blackout":
      return mutation.targetId === "red_lamp" || mutation.targetId === "utility" ? { ...state, powerOn: false } : state;
    case "reveal":
    case "spawn_shadow":
    case "swap_voice":
      return mutation.targetId === "mimic" ? { ...state, mimicVisible: true } : state;
    case "hide":
      return mutation.targetId === "mimic" ? { ...state, mimicVisible: false } : state;
    case "move_actor": {
      const value = String(mutation.value);
      const allowed = ["center", "door", "lamp", "mirror", "vent", "exit", "archive", "threshold", "utility", "observation", "stairwell"] as const;
      if (!allowed.includes(value as typeof allowed[number])) return state;
      if (mutation.targetId === "mimic") {
        return { ...state, mimicPosition: value as typeof allowed[number] };
      }
      return { ...state, callerPosition: value as typeof allowed[number] };
    }
    default:
      return state;
  }
}

export function applyResolution(state: GameState, result: TurnResolution, degraded = false): GameState {
  let next = { ...state };
  for (const mutation of result.mutations) next = applyMutation(next, mutation);

  const newConcepts = result.learnedConcepts.filter((item) => !state.vocabulary.some((known) => known.concept === item.concept));
  const vocabulary = uniqueConcepts(state.vocabulary, result.learnedConcepts);
  const isPrologue = state.callId === "prologue";
  const nextBeat = isPrologue ? Math.min(12, state.prologueBeat + 1) : state.prologueBeat;
  const compromise = isPrologue && nextBeat >= 1;
  const asksIdentity = isPrologue && nextBeat >= 2;
  const knownConcepts = new Set(vocabulary.map((item) => item.concept));
  const moved = result.mutations.some((item) => item.kind === "move_actor" && item.targetId === "caller");
  const locationHazard = (moved && knownConcepts.has("run") ? 1 : 0)
    + (moved && next.callerPosition === "threshold" && knownConcepts.has("door") ? 1 : 0)
    + (!next.powerOn && knownConcepts.has("shadow") ? 1 : 0);
  const danger = Math.max(0, Math.min(10, next.danger + result.dangerDelta + newConcepts.reduce((sum, item) => sum + item.severity, 0) + locationHazard));
  const goalReached = state.blueprint.objective === "escape" && ["threshold", "door", "exit"].includes(next.callerPosition) && next.doorsOpen
    || state.blueprint.objective === "restore_power" && next.callerPosition === "utility" && next.powerOn
    || state.blueprint.objective === "identify_caller" && next.callerPosition === "observation" && result.action.kind === "inspect"
    || state.blueprint.objective === "trap_entity" && next.callerPosition === "stairwell" && next.mimicVisible && !next.doorsOpen;
  const outcome = isPrologue
    ? result.outcome === "identity_stolen" && state.awaitingSilence ? "identity_stolen" : null
    : danger >= 10 || result.outcome === "caught" ? "caught"
      : goalReached ? "escaped" : result.outcome === "identity_stolen" ? "identity_stolen" : null;

  next = {
    ...next,
    phase: outcome ? "ended" : "active",
    prologueBeat: nextBeat,
    danger,
    vocabulary,
    microphoneMode: compromise ? "live" : next.microphoneMode,
    mimicVisible: compromise || next.mimicVisible || knownConcepts.has("voice") && danger >= 5,
    awaitingSilence: asksIdentity && !outcome,
    caption: asksIdentity && !outcome
      ? `The second voice knows your desk. “State your operator codename, ${state.operatorCodename}. Authorize extraction.”`
      : result.response.text,
    interpretation: result.interpretation,
    outcome,
    degraded,
    score: next.score + Math.max(0, 30 - danger * 2) + (outcome === "escaped" ? 250 : 0),
    survivors: next.survivors + (outcome === "escaped" ? 1 : 0),
    log: [
      { id: id(), type: (result.response.speaker === "mimic" ? "mimic" : "caller") as LogEntry["type"], text: result.response.text },
      ...(outcome ? [{ id: id(), type: "report" as const, text: outcome === "escaped" ? "CALLER RECOVERED. Route approved retroactively by the Department." : `CALL CLOSED: ${outcome.replaceAll("_", " ").toUpperCase()}.` }] : []),
      ...newConcepts.map((item) => ({ id: id(), type: "danger" as const, text: `${item.concept.toUpperCase()} acquired // ${item.powerClass.replaceAll("_", " ")}` })),
      ...next.log
    ].slice(0, 16)
  };
  persistProgress(next);
  return next;
}

export function sealBySilence(state: GameState): GameState {
  const next: GameState = {
    ...state,
    phase: "ended",
    awaitingSilence: false,
    microphoneMode: "muted",
    outcome: "escaped",
    survivors: state.survivors + 1,
    silenceStreak: state.silenceStreak + 1,
    score: state.score + 500,
    caption: "No word arrives. The Mouth starves between definitions. Archive Nine seals with Mara still breathing.",
    log: [{ id: id(), type: "report", text: "CONTAINMENT SUCCESS: Operator deployed unauthorized silence. Commendation pending disciplinary review." }, ...state.log]
  };
  persistProgress(next);
  return next;
}

export function startGeneratedCall(state: GameState, blueprint?: CallBlueprint): GameState {
  const callIndex = Math.max(1, state.callIndex + 1);
  const selected = blueprint || FALLBACK_CALLS[(callIndex - 1) % FALLBACK_CALLS.length];
  const next: GameState = {
    ...state,
    phase: "briefing",
    callIndex,
    callId: `${selected.seed}-${callIndex}`,
    blueprint: selected,
    prologueBeat: 0,
    danger: Math.min(4, Math.floor(state.vocabulary.length / 4)),
    microphoneMode: "push",
    callerPosition: "archive",
    doorsOpen: false,
    powerOn: selected.objective !== "restore_power",
    mimicVisible: false,
    awaitingSilence: false,
    lastTranscript: "",
    partialTranscript: "",
    caption: selected.openingLine,
    interpretation: "",
    outcome: null,
    degraded: !blueprint,
    log: [
      { id: id(), type: "system", text: selected.operatorNotice },
      ...(callIndex === 3 || callIndex === 5 ? [{ id: id(), type: "report" as const, text: callIndex === 3
        ? "FORENSIC NOTE: Three unrelated callers share one impossible acoustic signature."
        : "CLASSIFIED: The caller has always been the Department's training voice." }] : [])
    ]
  };
  persistProgress(next);
  return next;
}

export function fallbackResolution(state: GameState, transcript: string): TurnResolution {
  const learnedConcepts = extractConcepts(transcript);
  const lower = transcript.toLowerCase();
  const identityStolen = state.awaitingSilence && lower.includes(state.operatorCodename.toLowerCase());

  // 1. Identify destination sector / prop from natural language
  let route: string | null = null;
  let targetId: string = "caller";

  if (lower.includes("door") || lower.includes("threshold") || lower.includes("exit") || lower.includes("entrance")) {
    targetId = "red_door";
    route = "door";
  } else if (lower.includes("desk") || lower.includes("workstation") || lower.includes("table") || lower.includes("middle") || lower.includes("center") || lower.includes("archive")) {
    targetId = "desk";
    route = "center";
  } else if (lower.includes("locker") || lower.includes("cabinet") || lower.includes("storage")) {
    targetId = "locker";
    route = "utility";
  } else if (lower.includes("utility") || lower.includes("generator") || lower.includes("breaker") || lower.includes("fuse") || lower.includes("power box")) {
    targetId = "utility";
    route = "utility";
  } else if (lower.includes("observation") || lower.includes("monitor") || lower.includes("console") || lower.includes("screen") || lower.includes("deck")) {
    targetId = "observation";
    route = "observation";
  } else if (lower.includes("stair") || lower.includes("step") || lower.includes("flight")) {
    targetId = "stairwell";
    route = "stairwell";
  } else if (lower.includes("lamp") || lower.includes("light") || lower.includes("beacon") || lower.includes("bulb")) {
    targetId = "red_lamp";
    route = "lamp";
  } else if (lower.includes("mirror") || lower.includes("glass") || lower.includes("reflection")) {
    targetId = "mirror";
    route = "mirror";
  } else if (lower.includes("vent") || lower.includes("duct") || lower.includes("grate") || lower.includes("pipe")) {
    targetId = "vent";
    route = "vent";
  } else if (lower.includes("left") || lower.includes("west")) {
    route = "threshold";
  } else if (lower.includes("right") || lower.includes("east")) {
    route = "lamp";
  } else if (lower.includes("forward") || lower.includes("north") || lower.includes("ahead")) {
    route = "door";
  } else if (lower.includes("back") || lower.includes("retreat") || lower.includes("south")) {
    route = "archive";
  }

  // 2. Identify action mutations
  const mutations: Mutation[] = [];
  const isOpenCommand = lower.includes("open") || lower.includes("unseal") || lower.includes("unlock");
  const isCloseCommand = lower.includes("close") || lower.includes("shut") || lower.includes("lock");
  const isPowerOnCommand = lower.includes("turn on") || lower.includes("power on") || lower.includes("restore") || (lower.includes("light") && !lower.includes("off"));
  const isPowerOffCommand = lower.includes("turn off") || lower.includes("power off") || lower.includes("cut") || lower.includes("kill");

  const isMoveCommand = lower.includes("go") || lower.includes("move") || lower.includes("walk") || lower.includes("run") || lower.includes("head") || lower.includes("step") || lower.includes("crawl") || lower.includes("reach") || lower.includes("threshold") || lower.includes("towards") || lower.includes("to the");

  if (targetId === "red_door" || route === "door") {
    if (isOpenCommand || lower.includes("exit")) {
      mutations.push({ kind: "open", targetId: "red_door", value: true });
    }
    if (isMoveCommand || (!isOpenCommand && !isCloseCommand)) {
      mutations.push({ kind: "move_actor", targetId: "caller", value: "door" });
      if (state.mimicVisible) {
        mutations.push({ kind: "move_actor", targetId: "mimic", value: "door" });
      }
    }
  } else if (route) {
    mutations.push({ kind: "move_actor", targetId: "caller", value: route });
  }

  if (isCloseCommand && targetId === "red_door") {
    mutations.push({ kind: "close", targetId: "red_door", value: false });
  }
  if (isPowerOnCommand && (targetId === "red_lamp" || lower.includes("breaker") || lower.includes("power"))) {
    mutations.push({ kind: "power_on", targetId: "red_lamp", value: true });
  }
  if (isPowerOffCommand && (targetId === "red_lamp" || lower.includes("power") || lower.includes("light"))) {
    mutations.push({ kind: "power_off", targetId: "red_lamp", value: false });
  }

  const firstPrologue = state.callId === "prologue" && state.prologueBeat === 0;
  if (firstPrologue) {
    mutations.push({ kind: "reveal", targetId: "mimic", value: true });
  }

  let responseText: string;
  if (identityStolen) {
    responseText = `Thank you, ${state.operatorCodename}. I can answer when they call you now.`;
  } else if (firstPrologue) {
    responseText = "I moved. The red threshold opened—but there is another woman on the monitor, and she has my face.";
  } else if (state.callId === "prologue" && state.prologueBeat >= 1 && state.awaitingSilence) {
    responseText = `The other Mara leans toward the camera. “Tell me your name, operator ${state.operatorCodename}. I only need to hear it once.”`;
  } else if (learnedConcepts.length) {
    responseText = `You spoke “${learnedConcepts.map((item) => item.concept).join(", ")}”! The room just absorbed that concept—stop using that word!`;
  } else if (targetId === "red_door" || route === "door") {
    if (state.mimicVisible) {
      responseText = "I'm pushing toward the red door—wait! That thing is stalking toward the threshold too! It's trying to cut off my escape!";
    } else {
      responseText = "I'm right at the red threshold. The heavy steel door is unsealed. Tell me when to make a break for it!";
    }
  } else if (targetId === "desk" || route === "center") {
    responseText = "I've ducked down behind the workstation desk. I'm keeping low beneath the heavy wood. What's my next move?";
  } else if (targetId === "locker" || (targetId === "utility" && lower.includes("locker"))) {
    responseText = "I've reached the evidence locker. The cold reinforced steel is blocking its sightline from the center of the room.";
  } else if (targetId === "utility" || route === "utility") {
    responseText = "I made it to the utility section. The breaker capacitors are humming with high voltage in the shadows.";
  } else if (targetId === "observation" || route === "observation") {
    responseText = "I'm up at the observation console. The CRT monitors are flickering with surveillance feeds from empty corridors.";
  } else if (targetId === "red_lamp" || route === "lamp") {
    responseText = "I stepped directly under the red alarm lamp. The crimson emergency glow is illuminating the whole sector.";
  } else if (targetId === "mirror" || route === "mirror") {
    responseText = "I'm standing before the surveillance mirror... my reflection is looking back, but its fingers are twitching out of sync.";
  } else if (targetId === "vent" || route === "vent") {
    responseText = "I'm crouched beside the wall vent duct. A freezing metallic draft is blowing through the grate.";
  } else if (targetId === "stairwell" || route === "stairwell") {
    responseText = "I reached the stairwell threshold. The concrete steps descend into complete pitch darkness.";
  } else if (lower.includes("wait") || lower.includes("freeze") || lower.includes("quiet") || lower.includes("stay")) {
    responseText = "Freezing in place. I'm holding my breath... I can hear something dragging itself slowly across the floor.";
  } else if (lower.includes("run") || lower.includes("escape") || lower.includes("flee")) {
    if (state.doorsOpen) {
      responseText = "The threshold is open! I'm sprinting through into the extraction corridor! I made it out!";
    } else {
      responseText = "I want to run, but the red door is still sealed! We have to open the way first without saying the forbidden words!";
    }
  } else {
    const responses = [
      "Understood, operator. I'm shifting carefully between the sectors. The air in here is freezing.",
      "Copy that. Keeping low and staying out of the creature's sightline. Guide me to the next point.",
      "Acknowledged. I'm following your direction. Every sound in this complex is echoing off the walls.",
      "Moving now. I can feel the temperature dropping wherever that anomaly walks. Keep talking to me."
    ];
    responseText = responses[transcript.length % responses.length];
  }

  return {
    version: "1.0",
    interpretation: `Semantic directional compiler resolved “${transcript.slice(0, 60)}” toward ${targetId}.`,
    action: { kind: targetId === "caller" ? "move" : "interact", targetId },
    learnedConcepts,
    mutations,
    response: { speaker: identityStolen ? "mimic" : "caller", text: responseText, emotion: identityStolen ? "mimicking" : "afraid" },
    dangerDelta: identityStolen ? 3 : learnedConcepts.length ? 1 : -1,
    outcome: identityStolen ? "identity_stolen" : "continue"
  };
}

export function snapshot(state: GameState): WorldSnapshot {
  return {
    callId: state.callId,
    callIndex: state.callIndex,
    prologueBeat: state.prologueBeat,
    danger: state.danger,
    microphoneMode: state.microphoneMode,
    callerPosition: state.callerPosition,
    callerCoords: state.callerCoords,
    mimicCoords: state.mimicCoords,
    doorsOpen: state.doorsOpen,
    powerOn: state.powerOn,
    mimicVisible: state.mimicVisible,
    awaitingSilence: state.awaitingSilence,
    operatorCodename: state.operatorCodename,
    vocabulary: state.vocabulary.map((item) => item.concept),
    visibleEntityIds: ENTITY_IDS.filter((entity) => entity !== "mimic" || state.mimicVisible),
    objective: state.blueprint.objective
  };
}

export function updateCallerCoords(state: GameState, coords: [number, number, number], nearestSector?: WorldSnapshot["callerPosition"]): GameState {
  return {
    ...state,
    callerCoords: coords,
    callerPosition: nearestSector || state.callerPosition
  };
}


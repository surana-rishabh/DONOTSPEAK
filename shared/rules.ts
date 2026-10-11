import type { LearnedConcept, Mutation, TurnResolution, WorldSnapshot } from "./contracts.js";

export type Language = "en" | "hi";
export const CONCEPT_POWERS: Record<string, Omit<LearnedConcept, "concept">> = {
  door: { powerClass: "threshold_travel", severity: 2 }, open: { powerClass: "unseal", severity: 1 },
  light: { powerClass: "light_hunting", severity: 2 }, shadow: { powerClass: "shadow_spawn", severity: 2 },
  mirror: { powerClass: "duplication", severity: 2 }, voice: { powerClass: "voice_mimicry", severity: 2 },
  name: { powerClass: "identity_theft", severity: 3 }, run: { powerClass: "acceleration", severity: 1 },
  look: { powerClass: "gaze_lock", severity: 1 }, behind: { powerClass: "rear_ambush", severity: 2 },
  vent: { powerClass: "duct_crawl", severity: 1 }, silence: { powerClass: "null_field", severity: 1 }
};

// All three consumers (HUD, fallback and Gemma guard) use this exact vocabulary.
export const CONCEPT_ALIASES: Record<string, string[]> = {
  door: ["door", "doors", "दरवाजा", "दरवाज़ा", "दरवाजे", "दरवाज़े", "darwaza", "darwaze"],
  open: ["open", "opened", "खोल", "खोलो", "खोलना", "खुला", "kholo", "khol"],
  light: ["light", "lights", "रोशनी", "रौशनी", "बत्ती", "roshni", "batti"],
  shadow: ["shadow", "shadows", "परछाई", "परछाईं", "छाया", "parchai", "chhaya"],
  mirror: ["mirror", "mirrors", "आईना", "आइना", "शीशा", "aaina", "sheesha"],
  voice: ["voice", "आवाज", "आवाज़", "aawaz", "awaz"],
  name: ["name", "नाम", "naam"], run: ["run", "running", "दौड़", "दौड़ो", "daudo"],
  look: ["look", "देख", "देखो", "dekho"], behind: ["behind", "पीछे", "peeche", "piche"],
  vent: ["vent", "vents", "वेंट", "रोशनदान", "roshandan"],
  silence: ["silence", "खामोशी", "ख़ामोशी", "सन्नाटा", "khamoshi"]
};

export function words(text: string): string[] {
  return text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}_]+/gu) || [];
}
export function hasPhrase(text: string, aliases: string[]) {
  const normalized = ` ${words(text).join(" ")} `;
  return aliases.some((alias) => normalized.includes(` ${words(alias).join(" ")} `));
}
export function extractConcepts(text: string): LearnedConcept[] {
  return Object.entries(CONCEPT_ALIASES).filter(([, aliases]) => hasPhrase(text, aliases))
    .map(([concept]) => ({ concept, ...CONCEPT_POWERS[concept] }));
}
export const STATION_POSITIONS = {
  center: [0, 0, 0.8], archive: [0, 0, 0.8], door: [-3.55, 0, -2.8], threshold: [-3.55, 0, -2.8],
  exit: [-3.55, 0, -3.25], utility: [3.1, 0, -1.15], observation: [3.2, 0, 1.2],
  stairwell: [-3.1, 0, 2.5], lamp: [2.7, 0, 0.2], mirror: [3.8, 0, -1.8], vent: [-1.6, 0, -3.1]
} satisfies Record<WorldSnapshot["callerPosition"], [number, number, number]>;

export const STATIONS = [
  { id: "door", code: "A", name: "Red threshold", hindi: "लाल निशान", position: STATION_POSITIONS.door },
  { id: "utility", code: "B", name: "Power station", hindi: "बिजली केंद्र", position: STATION_POSITIONS.utility },
  { id: "observation", code: "C", name: "Signal station", hindi: "सिग्नल केंद्र", position: STATION_POSITIONS.observation },
  { id: "stairwell", code: "D", name: "Holding area", hindi: "रोकने की जगह", position: STATION_POSITIONS.stairwell }
] as const;

const TARGETS: Array<[WorldSnapshot["callerPosition"], string, string[]]> = [
  ["door", "red_door", ["to a", "marker a", "point a", "ए", "red barrier", "red mark", "red threshold", "blue door", "door", "threshold", "exit", "entrance", "लाल निशान", "लाल रुकावट", "नीला दरवाजा", "darwaza", "दरवाजा", "दरवाज़ा", "darwaze", "lal nishan", "lal rukawat", "left", "बाएं", "बायें", "baaye"]],
  ["utility", "utility", ["b", "बी", "utility", "generator", "breaker", "power station", "बिजली केंद्र", "जनरेटर", "ब्रेकर", "bijli kendra", "right", "दाएं", "daaye"]],
  ["observation", "observation", ["c", "सी", "observation", "signal station", "monitor", "screen", "सिग्नल केंद्र", "स्क्रीन", "निगरानी", "signal kendra"]],
  ["stairwell", "stairwell", ["d", "डी", "stairs", "stairwell", "holding area", "सीढ़ी", "सीढ़ियों", "रोकने की जगह", "seedhi", "सीढी"]],
  ["center", "desk", ["center", "middle", "desk", "table", "workstation", "बीच", "मेज", "mez", "beech"]],
  ["mirror", "mirror", CONCEPT_ALIASES.mirror], ["vent", "vent", CONCEPT_ALIASES.vent],
  ["lamp", "red_lamp", ["lamp", "beacon", ...CONCEPT_ALIASES.light]]
];

export type Instruction = { kind: TurnResolution["action"]["kind"]; targetId: string | null; route: WorldSnapshot["callerPosition"] | null; operation: "release" | "seal" | "activate" | "deactivate" | null; confirm: boolean; verdict: "trust" | "contain" | null; negated: boolean; stay: boolean };
export function parseInstruction(text: string, state: WorldSnapshot): Instruction {
  const negated = hasPhrase(text, ["don't", "do not", "never", "not", "no", "stop", "मत", "नहीं", "mat", "nahi", "nahin"]);
  const target = TARGETS.find(([, , aliases]) => aliases.some((alias) => hasPhrase(text, [alias]) && (alias !== "to a" || words(text).at(-1) === "a")));
  const move = hasPhrase(text, ["go", "move", "walk", "head", "reach", "toward", "towards", "चलो", "जाओ", "जाना", "चल", "chalo", "jao", "चलें", "पहुंचो", "आगे बढ़ो"]);
  const inspect = hasPhrase(text, ["inspect", "check", "scan", "compare", "test", "जांच", "जाँच", "जांचो", "जाँचो", "जांच करो", "परखो", "jaanch", "janch"]);
  let operation: Instruction["operation"] = null;
  if (hasPhrase(text, ["close", "shut", "lock", "seal", "बंद", "सील", "band", "rok do"])) operation = "seal";
  else if (hasPhrase(text, ["release", "unseal", "unlock", "open", "हटाओ", "हटा", "छोड़ो", "kholo", "khol", "खोल", "खोलो", "hatao"])) operation = "release";
  if (hasPhrase(text, ["turn off", "power off", "deactivate", "बिजली बंद", "bijli band"])) operation = "deactivate";
  else if (hasPhrase(text, ["activate", "restore", "turn on", "power on", "चालू", "बहाल", "chalu", "bahal"])) operation = "activate";
  const confirm = hasPhrase(text, ["proceed", "continue", "verify", "confirm", "go ahead", "carry on", "keep going", "let's go", "lets go", "move forward", "all set", "you can leave", "you're good to go", "you are good to go", "make your way out", "next step", "आगे", "पुष्टि", "आगे बढ़ो", "आगे चलो", "जारी रखो", "बढ़ो", "अब निकलो", "aage", "pushti", "badho", "jaari rakho", "ab niklo"]);
  const verdict = hasPhrase(text, ["contain", "isolate", "रोकें", "रोको", "अलग", "roko", "alag"]) ? "contain"
    : hasPhrase(text, ["trust", "human", "भरोसा", "इंसान", "bharosa", "insaan"]) ? "trust" : null;
  return { kind: negated ? "refuse" : inspect ? "inspect" : operation ? "interact" : move && target ? "move" : "wait",
    targetId: target?.[1] ?? (operation ? ["door", "threshold", "exit"].includes(state.callerPosition) ? "red_door" : state.callerPosition === "utility" ? "utility" : null : null),
    route: move && target && !negated ? target[0] : null, operation: negated ? null : operation,
    confirm: !negated && confirm, verdict: negated ? null : verdict, negated,
    stay: !negated && hasPhrase(text, ["wait", "stay", "hold position", "remain there", "रुको", "रुकें", "ruko", "वहीं रहो", "wahi raho"]) };
}

export function resolveInstruction(text: string, state: WorldSnapshot, intent?: TurnResolution["semanticIntent"]): Instruction {
  const local = parseInstruction(text, state);
  if (!intent || intent.confidence < 0.4 || local.negated || local.kind !== "wait" || local.confirm || local.verdict || local.stay) return local;
  const targetId = intent.target === "door" ? "red_door" : intent.target === "center" ? "desk" : intent.target === "lamp" ? "red_lamp" : intent.target === "none" ? null : intent.target;
  if (targetId && !state.visibleEntityIds.includes(targetId)) return local;
  return { kind: intent.kind, targetId: targetId ?? (intent.kind === "interact" ? ["door", "threshold", "exit"].includes(state.callerPosition) ? "red_door" : state.callerPosition === "utility" ? "utility" : null : null),
    route: intent.kind === "move" && intent.target !== "none" ? intent.target : null,
    operation: intent.kind === "interact" && intent.operation !== "none" ? intent.operation : null,
    confirm: intent.kind === "wait" && intent.confirm, verdict: intent.kind === "wait" && intent.verdict !== "none" ? intent.verdict : null,
    stay: intent.kind === "wait" && intent.stay, negated: intent.kind === "refuse" };
}

export function localTurn(state: WorldSnapshot, transcript: string, input = parseInstruction(transcript, state)): TurnResolution {
  const mutations: Mutation[] = [];
  if (input.route) mutations.push({ kind: "move_actor", targetId: "caller", value: input.route });
  const atDoor = ["door", "threshold", "exit"].includes(state.callerPosition);
  if (!input.route && atDoor && input.targetId === "red_door" && input.operation === "release") mutations.push({ kind: "open", targetId: "red_door", value: true });
  if (!input.route && (atDoor || state.callerPosition === "stairwell") && input.operation === "seal") mutations.push({ kind: "close", targetId: "red_door", value: false });
  if (!input.route && state.callerPosition === "utility" && input.operation === "activate") mutations.push({ kind: "power_on", targetId: "utility", value: true });
  if (!input.route && state.callerPosition === "utility" && input.operation === "deactivate") mutations.push({ kind: "power_off", targetId: "utility", value: false });
  const hi = state.language === "hi";
  const text = input.negated ? hi ? "ठीक है। मैं यहीं रुकी हूँ।" : "Understood. I am staying here."
    : input.route ? hi ? "मैं उस निशान तक धीरे चल रही हूँ। अगला निर्देश?" : "Moving carefully to that marker. What next?"
    : mutations.length ? hi ? "हो गया। अब आप आगे बढ़ने की पुष्टि कर सकते हैं।" : "Done. You can confirm when you are ready."
    : input.operation ? hi ? "पहले सही निशान तक पहुँचें, फिर यह निर्देश दें।" : "Reach the correct marker first, then give that instruction."
    : input.kind === "inspect" ? hi ? "सिग्नल की जाँच कर रही हूँ।" : "Checking the signal."
    : hi ? "कृपया एक निर्देश दें। किसी निशान तक जाना है, या यहीं कुछ करना है?" : "One instruction at a time. Should I move to a marker, or act here?";
  return { version: "1.0", interpretation: text, action: { kind: input.kind, targetId: input.targetId },
    learnedConcepts: extractConcepts(transcript), mutations,
    response: { speaker: "caller", text, emotion: input.kind === "wait" ? "confused" : "afraid" }, dangerDelta: 0, outcome: "continue" };
}

export function guardTurn(result: TurnResolution, state: WorldSnapshot, transcript: string): TurnResolution {
  if (result.semanticIntent) {
    const instruction = resolveInstruction(transcript, state, result.semanticIntent);
    const safe = localTurn(state, transcript, instruction);
    const accepted = result.semanticIntent.confidence >= 0.4 && !instruction.negated;
    return { ...safe, semanticIntent: accepted ? result.semanticIntent : undefined,
      response: accepted && (instruction.kind === "wait" || instruction.kind === "inspect" || safe.mutations.length) ? result.response : safe.response };
  }
  const parsed = parseInstruction(transcript, state);
  const local = localTurn(state, transcript);
  const places = new Set(Object.keys(STATION_POSITIONS));
  // A model may ground an unfamiliar indirect destination, but never bypass an interaction or win gate.
  const groundedMove = result.action.kind === "move" && state.visibleEntityIds.includes(result.action.targetId || "") && !parsed.negated
    ? result.mutations.filter((m) => m.kind === "move_actor" && m.targetId === "caller" && typeof m.value === "string" && places.has(m.value)).slice(0, 1) : [];
  const groundedInteraction = result.action.kind === "interact" && !parsed.negated ? result.mutations.filter((m) =>
    m.kind === "open" && m.targetId === "red_door" && ["door", "threshold", "exit"].includes(state.callerPosition)
    || m.kind === "close" && m.targetId === "red_door" && ["door", "threshold", "exit", "stairwell"].includes(state.callerPosition)
    || m.kind === "power_on" && m.targetId === "utility" && state.callerPosition === "utility").slice(0, 1) : [];
  const useLocal = parsed.kind !== "wait" || parsed.confirm || parsed.verdict || parsed.negated;
  return { ...result, action: useLocal ? local.action : groundedMove.length ? result.action : { kind: "wait", targetId: null },
    learnedConcepts: extractConcepts(transcript).filter((c) => !state.vocabulary.includes(c.concept)),
    mutations: useLocal ? local.mutations : [...groundedMove, ...groundedInteraction], dangerDelta: 0, outcome: "continue",
    response: parsed.negated || (parsed.operation && !local.mutations.length) || (!useLocal && !groundedMove.length && !groundedInteraction.length && result.action.kind !== "wait") ? local.response : result.response };
}

export function objectiveSteps(state: Pick<WorldSnapshot, "objective" | "language">): string[] {
  const hi = state.language === "hi";
  switch (state.objective) {
    case "escape": return hi ? ["A तक जाएँ", "रुकावट हटाएँ", "आगे बढ़ने को कहें"] : ["Reach A", "Release the barrier", "Tell the caller to continue"];
    case "restore_power": return hi ? ["B तक जाएँ", "केंद्र चालू करें", "काम पूरा होने की पुष्टि करें"] : ["Reach B", "Activate the station", "Confirm the station is ready"];
    case "identify_caller": return hi ? ["C तक जाएँ", "सिग्नल जाँचें", "भरोसा करें या रोकें"] : ["Reach C", "Check the signal", "Say ‘trust’ or ‘contain’"];
    case "trap_entity": return hi ? ["D तक जाएँ", "वहाँ रुकें", "क्षेत्र सील करें"] : ["Reach D", "Wait there", "Seal the area"];
  }
}

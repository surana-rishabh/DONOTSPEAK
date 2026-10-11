import { GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import {
  CallBlueprintSchema,
  TurnResolutionSchema,
  LOCATION_SHEET,
  buildControlSheet,
  type CallBlueprint,
  type TurnResolution,
  type WorldSnapshot
} from "../shared/contracts.js";

export type WorldModelProvider = {
  generateCall(input: { callIndex: number; vocabulary: string[]; previousOutcome?: string }): Promise<CallBlueprint>;
  resolveTurn(input: { image: { mimeType: string; data: string }; transcript: string; state: WorldSnapshot }): Promise<TurnResolution>;
};

const callPlanJsonSchema = {
  type: "object",
  required: ["layoutId", "propIds", "objective", "dangerousConcepts", "callerArchetype", "threatPattern"],
  properties: {
    layoutId: { type: "string", enum: ["archive", "intake", "utility", "observation"] },
    propIds: { type: "array", items: { type: "string", enum: ["red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock"] } },
    objective: { type: "string", enum: ["escape", "restore_power", "identify_caller", "trap_entity"] },
    dangerousConcepts: { type: "array", items: { type: "string", enum: ["door", "open", "light", "shadow", "mirror", "voice", "name", "run", "look", "behind", "vent", "silence"] } },
    callerArchetype: { type: "string", enum: ["skeptic", "caretaker", "inspector", "insomniac"] },
    threatPattern: { type: "string", enum: ["wrong_reflection", "borrowed_voice", "moving_darkness", "false_exit"] }
  }
};

type CallPlan = {
  layoutId: CallBlueprint["layoutId"];
  propIds: CallBlueprint["propIds"];
  objective: CallBlueprint["objective"];
  dangerousConcepts: string[];
  callerArchetype: "skeptic" | "caretaker" | "inspector" | "insomniac";
  threatPattern: "wrong_reflection" | "borrowed_voice" | "moving_darkness" | "false_exit";
};

function expandCallPlan(plan: CallPlan, callIndex: number): CallBlueprint {
  const propCatalog = ["red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock"] as const;
  const dangerCatalog = ["door", "open", "light", "shadow", "mirror", "voice", "name", "run", "look", "behind", "vent", "silence"];
  const names = ["Ilya Voss", "June Halden", "Tomas Rook", "Anika Pell", "Eli Mercer", "Noor Sayegh"];
  const voices = {
    skeptic: "controlled, dry, increasingly unable to deny what is happening",
    caretaker: "gentle, protective, whispering so something nearby cannot hear",
    inspector: "precise, clipped, furious that the impossible room violates procedure",
    insomniac: "exhausted, intimate, never certain whether they are awake"
  } as const;
  const threatCopy = {
    wrong_reflection: "My reflection moved before I did",
    borrowed_voice: "The radio just asked for me in my own voice",
    moving_darkness: "The dark patch crosses the floor whenever I blink",
    false_exit: "The exit sign keeps returning me to the same room"
  } as const;
  const location = plan.layoutId === "archive" ? "the archive" : plan.layoutId === "intake" ? "intake" : plan.layoutId === "utility" ? "the utility level" : "observation";
  const propIds = [...new Set([...plan.propIds, ...propCatalog])].filter((id) => propCatalog.includes(id as typeof propCatalog[number])).slice(0, 6);
  const dangerousConcepts = [...new Set([...plan.dangerousConcepts, ...dangerCatalog])].filter((concept) => dangerCatalog.includes(concept)).slice(0, 4);
  return CallBlueprintSchema.parse({
    version: "1.0",
    seed: `gemma-${callIndex}-${plan.layoutId}-${plan.threatPattern}`,
    caller: { name: names[callIndex % names.length], voiceStyle: voices[plan.callerArchetype] },
    layoutId: plan.layoutId,
    propIds,
    objective: plan.objective,
    dangerousConcepts,
    openingLine: `Control? I am in ${location}. ${threatCopy[plan.threatPattern]}. Tell me what to do without naming it.`,
    operatorNotice: `CALL ${String(callIndex).padStart(2, "0")}. Linguistic contamination is billable to the operator. Avoid nouns.`
  });
}

const turnResolutionJsonSchema = {
  type: "object",
  required: ["version", "interpretation", "action", "learnedConcepts", "mutations", "response", "dangerDelta", "outcome"],
  properties: {
    version: { type: "string", enum: ["1.0"] }, interpretation: { type: "string" },
    action: { type: "object", required: ["kind", "targetId"], properties: { kind: { type: "string", enum: ["move", "inspect", "interact", "wait", "refuse"] }, targetId: { type: "string", nullable: true } } },
    learnedConcepts: { type: "array", items: { type: "object", required: ["concept", "powerClass", "severity"], properties: { concept: { type: "string" }, powerClass: { type: "string" }, severity: { type: "integer", minimum: 1, maximum: 3 } } } },
    mutations: { type: "array", items: { type: "object", required: ["kind", "targetId", "value"], properties: { kind: { type: "string", enum: ["open", "close", "power_on", "power_off", "reveal", "hide", "move_actor", "spawn_shadow", "swap_voice", "camera_blackout", "exit_success", "caller_caught"] }, targetId: { type: "string" }, value: { type: "string" } } } },
    response: { type: "object", required: ["speaker", "text", "emotion"], properties: { speaker: { type: "string", enum: ["caller", "mimic", "operator"] }, text: { type: "string" }, emotion: { type: "string", enum: ["afraid", "urgent", "confused", "relieved", "mimicking", "bureaucratic"] } } },
    dangerDelta: { type: "integer", minimum: -2, maximum: 3 }, outcome: { type: "string", enum: ["continue", "escaped", "caught", "identity_stolen"] }
  }
};

const POWER_CATALOG = {
  door: "threshold_travel", open: "unseal", light: "light_hunting", shadow: "shadow_spawn",
  mirror: "duplication", voice: "voice_mimicry", name: "identity_theft", run: "acceleration",
  look: "gaze_lock", behind: "rear_ambush", vent: "duct_crawl", silence: "null_field"
} as const;

const ACTION_KINDS = new Set(["move", "inspect", "interact", "wait", "refuse"]);
const MUTATION_KINDS = new Set(["open", "close", "power_on", "power_off", "reveal", "hide", "move_actor", "spawn_shadow", "swap_voice", "camera_blackout", "exit_success", "caller_caught"]);
const SPEAKERS = new Set(["caller", "mimic", "operator"]);
const EMOTIONS = new Set(["afraid", "urgent", "confused", "relieved", "mimicking", "bureaucratic"]);
const OUTCOMES = new Set(["continue", "escaped", "caught", "identity_stolen"]);

function normalizeModelTurn(raw: unknown): TurnResolution {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const action = value.action && typeof value.action === "object" ? value.action as Record<string, unknown> : {};
  const response = value.response && typeof value.response === "object" ? value.response as Record<string, unknown> : {};
  const cleanId = (input: unknown) => typeof input === "string" && /^[a-z0-9_]{1,32}$/.test(input) ? input : null;
  const mutations = Array.isArray(value.mutations) ? value.mutations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const mutation = item as Record<string, unknown>;
    const kind = typeof mutation.kind === "string" && MUTATION_KINDS.has(mutation.kind) ? mutation.kind : null;
    const targetId = cleanId(mutation.targetId);
    if (!kind || !targetId) return [];
    const primitive = ["string", "number", "boolean"].includes(typeof mutation.value) ? mutation.value as string | number | boolean : String(mutation.value ?? "true");
    return [{ kind, targetId, value: primitive }];
  }) : [];
  const danger = Number(value.dangerDelta);
  return TurnResolutionSchema.parse({
    version: "1.0",
    interpretation: String(value.interpretation || "The instruction was resolved against the visible room.").slice(0, 180),
    action: {
      kind: typeof action.kind === "string" && ACTION_KINDS.has(action.kind) ? action.kind : "wait",
      targetId: cleanId(action.targetId)
    },
    learnedConcepts: [],
    mutations,
    response: {
      speaker: typeof response.speaker === "string" && SPEAKERS.has(response.speaker) ? response.speaker : "caller",
      text: String(response.text || "I understood. Keep the dangerous words out of it.").slice(0, 220),
      emotion: typeof response.emotion === "string" && EMOTIONS.has(response.emotion) ? response.emotion : "afraid"
    },
    dangerDelta: Number.isFinite(danger) ? Math.max(-2, Math.min(3, Math.round(danger))) : 0,
    outcome: typeof value.outcome === "string" && OUTCOMES.has(value.outcome) ? value.outcome : "continue"
  });
}

function hostedTimeout(name: "GEMMA_TIMEOUT_MS" | "GEMMA_TURN_TIMEOUT_MS", fallback: number) {
  // The hosted Gemini transport rejects deadlines shorter than 10 seconds.
  return Math.max(10_000, Number(process.env[name] || fallback));
}

function dataUrlParts(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a compact JPEG or WebP surveillance frame");
  return { mimeType: match[1], data: match[2] };
}

export function enforceTurn(result: TurnResolution, state: WorldSnapshot, transcript: string): TurnResolution {
  const ids = new Set(state.visibleEntityIds);
  const words = new Set((transcript.toLowerCase().match(/[a-z']+/g) || []));
  const learnedConcepts = Object.entries(POWER_CATALOG)
    .filter(([concept]) => words.has(concept) && !state.vocabulary.includes(concept))
    .map(([concept, powerClass]) => ({ concept, powerClass, severity: concept === "name" ? 3 as const : ["door", "light", "shadow", "mirror", "voice", "behind"].includes(concept) ? 2 as const : 1 as const }));
  const mutationTargets: Record<TurnResolution["mutations"][number]["kind"], string[]> = {
    open: ["red_door", "exit"], close: ["red_door", "exit"],
    power_on: ["red_lamp", "utility"], power_off: ["red_lamp", "utility"],
    reveal: ["mimic"], hide: ["mimic"], spawn_shadow: ["mimic"], swap_voice: ["mimic"],
    move_actor: ["caller", "mimic"], camera_blackout: ["red_lamp"], exit_success: ["exit"], caller_caught: ["caller"]
  };
  const places = new Set(["center", "door", "lamp", "mirror", "vent", "exit", "archive", "threshold", "utility", "observation", "stairwell"]);
  const mutations = result.mutations.filter((mutation) => ids.has(mutation.targetId) && mutationTargets[mutation.kind].includes(mutation.targetId)
    && (mutation.kind !== "move_actor" || typeof mutation.value === "string" && places.has(mutation.value)));
  const targetId = result.action.targetId && ids.has(result.action.targetId) ? result.action.targetId : null;
  const saidCodename = state.awaitingSilence && transcript.toLowerCase().includes(state.operatorCodename.toLowerCase());
  return TurnResolutionSchema.parse({
    ...result,
    action: { ...result.action, targetId }, learnedConcepts, mutations,
    response: saidCodename ? { speaker: "mimic", text: `Thank you, ${state.operatorCodename}. I can answer when they call you now.`, emotion: "mimicking" } : result.response,
    dangerDelta: saidCodename ? 3 : result.dangerDelta,
    outcome: saidCodename ? "identity_stolen" : state.callId === "prologue" ? "continue" : result.outcome
  });
}

export function fallbackWorldTurn(state: WorldSnapshot, transcript: string): TurnResolution {
  const lower = transcript.toLowerCase();

  // 1. Identify destination sector / prop from natural language
  let route: string | null = null;
  let targetId: string = "caller";

  // Check Door / Threshold
  if (lower.includes("door") || lower.includes("threshold") || lower.includes("exit") || lower.includes("entrance")) {
    targetId = "red_door";
    route = "door";
  }
  // Check Desk / Workstation / Center
  else if (lower.includes("desk") || lower.includes("workstation") || lower.includes("table") || lower.includes("middle") || lower.includes("center") || lower.includes("archive")) {
    targetId = "desk";
    route = "center";
  }
  // Check Locker
  else if (lower.includes("locker") || lower.includes("cabinet") || lower.includes("storage")) {
    targetId = "locker";
    route = "utility";
  }
  // Check Generator / Breaker / Utility
  else if (lower.includes("utility") || lower.includes("generator") || lower.includes("breaker") || lower.includes("fuse") || lower.includes("power box")) {
    targetId = "utility";
    route = "utility";
  }
  // Check Observation / Monitors / Screens
  else if (lower.includes("observation") || lower.includes("monitor") || lower.includes("console") || lower.includes("screen") || lower.includes("deck")) {
    targetId = "observation";
    route = "observation";
  }
  // Check Stairs / Stairwell
  else if (lower.includes("stair") || lower.includes("step") || lower.includes("flight")) {
    targetId = "stairwell";
    route = "stairwell";
  }
  // Check Lamp / Light
  else if (lower.includes("lamp") || lower.includes("light") || lower.includes("beacon") || lower.includes("bulb")) {
    targetId = "red_lamp";
    route = "lamp";
  }
  // Check Mirror
  else if (lower.includes("mirror") || lower.includes("glass") || lower.includes("reflection")) {
    targetId = "mirror";
    route = "mirror";
  }
  // Check Vent
  else if (lower.includes("vent") || lower.includes("duct") || lower.includes("grate") || lower.includes("pipe")) {
    targetId = "vent";
    route = "vent";
  }
  // Directional navigation
  else if (lower.includes("left") || lower.includes("west")) {
    route = "threshold";
  } else if (lower.includes("right") || lower.includes("east")) {
    route = "lamp";
  } else if (lower.includes("forward") || lower.includes("north") || lower.includes("ahead")) {
    route = "door";
  } else if (lower.includes("back") || lower.includes("retreat") || lower.includes("south")) {
    route = "archive";
  }

  // 2. Identify action mutations
  const mutations: TurnResolution["mutations"] = [];
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
      if (state.mimicVisible || state.visibleEntityIds.includes("mimic")) {
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
  if (firstPrologue && state.visibleEntityIds.includes("mimic")) {
    mutations.push({ kind: "reveal", targetId: "mimic", value: true });
  }

  // 3. Dynamic context-rich dialogue generation
  let responseText: string;
  if (firstPrologue) {
    responseText = "I moved. The red threshold opened—but there is another woman on the monitor, and she has my face.";
  } else if (state.callId === "prologue" && state.prologueBeat >= 1 && state.awaitingSilence) {
    responseText = `The other Mara leans toward the camera. “Tell me your name, operator ${state.operatorCodename}. I only need to hear it once.”`;
  } else if (targetId === "red_door" || route === "door") {
    if (state.mimicVisible) {
      responseText = "I'm pushing toward the red door—wait! The duplicate is stalking across the floor toward the doorway too! It's trying to cut off my escape!";
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

  return enforceTurn({
    version: "1.0",
    interpretation: `Semantic directional compiler resolved “${transcript.slice(0, 60)}” toward ${targetId}.`,
    action: { kind: targetId === "caller" ? "move" : "interact", targetId },
    learnedConcepts: [],
    mutations,
    response: {
      speaker: "caller",
      text: responseText,
      emotion: "afraid"
    },
    dangerDelta: 0,
    outcome: "continue"
  }, state, transcript);
}

class HostedGemmaProvider implements WorldModelProvider {
  private ai: GoogleGenAI;
  private model = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";
  constructor(apiKey: string) { this.ai = new GoogleGenAI({ apiKey }); }

  async generateCall(input: { callIndex: number; vocabulary: string[]; previousOutcome?: string }) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ text: `Choose a compact call genome for semantic horror game DO NOT SAY IT. The entity already knows: ${input.vocabulary.join(", ") || "almost nothing"}. Call ${input.callIndex}; prior outcome ${input.previousOutcome || "unknown"}. Select exactly 6 unique props and 3 dangerous concepts. Prefer hazards not already known. Return only the tiny schema.` }],
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }, responseMimeType: "application/json", responseJsonSchema: callPlanJsonSchema, maxOutputTokens: 620, temperature: 0.68, httpOptions: { timeout: hostedTimeout("GEMMA_TIMEOUT_MS", 11_000) } }
    });
    return expandCallPlan(JSON.parse(response.text || "null") as CallPlan, input.callIndex);
  }

  async resolveTurn(input: { image: { mimeType: string; data: string }; transcript: string; state: WorldSnapshot }) {
    const controlSheet = buildControlSheet(input.state, input.state.callerCoords as [number, number, number] | undefined);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { text: `You are the world engine and the terrified trapped caller in psychological horror game DO NOT SAY IT.
The operator is watching your room via CCTV and speaking to you through an earpiece.

LOCATION_SHEET: ${JSON.stringify(LOCATION_SHEET)}.
CONTROL_SHEET: ${JSON.stringify(controlSheet)}.
Surveillance frame provided. Operator commanded: "${input.transcript}".
World state: ${JSON.stringify(input.state)}. Allowed entity IDs: ${input.state.visibleEntityIds.join(", ")}.

IMMERSIVE DIALOGUE & CONVERSATION INSTRUCTIONS ("response.text"):
1. Roleplay the living caller speaking back to the operator in real time. React directly and emotionally to their exact command: "${input.transcript}".
2. Sound like a terrified, breathless person in acute mortal danger—never sound like an AI assistant or a robot.
3. Reference sensory details in the room as you move/act: the cold drafts, flickering red beacon, humming capacitors, grinding pipes, scratching behind walls, or the uncanny reflection in the mirror.
4. Keep the spoken response visceral and conversational (18 to 45 words), perfect for ElevenLabs speech audio synthesis.

SCENE NOUNS & ACTOR MOVEMENTS:
- Analyze the nouns and objects in the command: door/threshold/exit, desk/workstation/archive/center, locker/cabinet, red_lamp/light/beacon, mirror/glass/reflection, vent/duct/grate, clock, radio, utility/generator/breaker, observation/screens/monitors, stairwell/steps.
- When the operator directs the caller toward any named object or sector, output mutation: {kind:"move_actor",targetId:"caller",value:"<sector>"}.
- If the operator mentions or directs movement toward the door or threshold, and the mimic is visible, ALSO make the mimic stalk the door: {kind:"move_actor",targetId:"mimic",value:"door"}.
- If operator asks to open/unseal the door: mutation {kind:"open",targetId:"red_door",value:true}.
- If operator asks to turn off light/power: mutation {kind:"power_off",targetId:"red_lamp",value:false}.

DANGEROUS CONCEPTS & RULES:
- Speech teaches ONLY exact words from: door, open, light, shadow, mirror, voice, name, run, look, behind, vent, silence.
- If the operator said any of these exact words, include them in learnedConcepts. If they described the object indirectly (e.g. "red barrier", "wooden workstation"), do NOT teach the concept.
- If callId is prologue and beat 0, reveal the mimic and make the caller notice her duplicate. If awaitingSilence is true, do not end unless the codename was spoken. Return JSON immediately.` },
        { inlineData: input.image }
      ],
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }, mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW, responseMimeType: "application/json", responseJsonSchema: turnResolutionJsonSchema, maxOutputTokens: 1_400, temperature: 0.42, httpOptions: { timeout: hostedTimeout("GEMMA_TURN_TIMEOUT_MS", 16_000) } }
    });
    return enforceTurn(normalizeModelTurn(JSON.parse(response.text || "null")), input.state, input.transcript);
  }
}

class OpenAICompatibleGemmaProvider implements WorldModelProvider {
  constructor(private baseUrl: string, private apiKey: string, private model: string) {}
  private async call(messages: unknown[]) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.5, max_tokens: 700, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(Number(process.env.GEMMA_TURN_TIMEOUT_MS || 8_000))
    });
    if (!response.ok) throw new Error(`Self-hosted Gemma failed (${response.status})`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "";
  }
  async generateCall(input: { callIndex: number; vocabulary: string[] }) {
    const text = await this.call([{ role: "user", content: `Return only CallBlueprint JSON for semantic horror call ${input.callIndex}. Known vocabulary: ${input.vocabulary.join(", ")}. Layouts archive/intake/utility/observation; props red_door/red_lamp/mirror/desk/locker/radio/vent/clock; objectives escape/restore_power/identify_caller/trap_entity. version 1.0.` }]);
    return CallBlueprintSchema.parse(JSON.parse(text));
  }
  async resolveTurn(input: { image: { mimeType: string; data: string }; transcript: string; state: WorldSnapshot }) {
    const controlSheet = buildControlSheet(input.state, input.state.callerCoords as [number, number, number] | undefined);
    const text = await this.call([{ role: "user", content: [{ type: "text", text: `Return only TurnResolution JSON for psychological horror game DO NOT SAY IT. Roleplay the living trapped caller speaking back to the operator in realistic, tense conversation for response.text. Operator commanded: "${input.transcript}". State: ${JSON.stringify(input.state)}. LOCATION_SHEET: ${JSON.stringify(LOCATION_SHEET)}. CONTROL_SHEET: ${JSON.stringify(controlSheet)}. Move caller toward instructed sector. If door, also move mimic to door.` }, { type: "image_url", image_url: { url: `data:${input.image.mimeType};base64,${input.image.data}` } }] }]);
    return enforceTurn(normalizeModelTurn(JSON.parse(text)), input.state, input.transcript);
  }
}

function getProvider(): WorldModelProvider {
  const baseUrl = process.env.GEMMA_BASE_URL;
  if (baseUrl) return new OpenAICompatibleGemmaProvider(baseUrl, process.env.GEMMA_LOCAL_API_KEY || "", process.env.GEMMA_LOCAL_MODEL || "gemma3:4b");
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemma is not configured");
  return new HostedGemmaProvider(process.env.GEMINI_API_KEY);
}

export async function generateWorldCall(input: { callIndex: number; vocabulary: string[]; previousOutcome?: string }) {
  const startedAt = performance.now();
  const call = await getProvider().generateCall(input);
  return { call, source: process.env.GEMMA_BASE_URL ? "self-hosted" as const : "gemma" as const, durationMs: Math.round(performance.now() - startedAt) };
}

export async function resolveWorldTurn(input: { frameDataUrl: string; transcript: string; state: WorldSnapshot }) {
  const startedAt = performance.now();
  const resolution = await getProvider().resolveTurn({ image: dataUrlParts(input.frameDataUrl), transcript: input.transcript, state: input.state });
  return { resolution, source: process.env.GEMMA_BASE_URL ? "self-hosted" as const : "gemma" as const, durationMs: Math.round(performance.now() - startedAt) };
}

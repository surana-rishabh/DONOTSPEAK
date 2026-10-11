import { z } from "zod";

export const ObjectiveSchema = z.enum(["escape", "restore_power", "identify_caller", "trap_entity"]);
export const ActionKindSchema = z.enum(["move", "inspect", "interact", "wait", "refuse"]);
export const OutcomeSchema = z.enum(["continue", "escaped", "caught", "identity_stolen"]);
export const SpeakerSchema = z.enum(["caller", "mimic", "operator"]);
export const MutationKindSchema = z.enum([
  "open", "close", "power_on", "power_off", "reveal", "hide", "move_actor",
  "spawn_shadow", "swap_voice", "camera_blackout", "exit_success", "caller_caught"
]);

export const CallBlueprintSchema = z.object({
  version: z.literal("1.0"),
  seed: z.string().min(3).max(48),
  caller: z.object({
    name: z.string().min(1).max(32),
    voiceStyle: z.string().min(3).max(80)
  }),
  layoutId: z.enum(["archive", "intake", "utility", "observation"]),
  propIds: z.array(z.enum(["red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock"])).min(4).max(8),
  objective: ObjectiveSchema,
  dangerousConcepts: z.array(z.string().regex(/^[a-z_]+$/).max(24)).min(2).max(6),
  openingLine: z.string().min(8).max(180),
  operatorNotice: z.string().min(8).max(180)
});

export const LearnedConceptSchema = z.object({
  concept: z.string().regex(/^[a-z_]+$/).max(24),
  powerClass: z.string().regex(/^[a-z_]+$/).max(32),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

export const MutationSchema = z.object({
  kind: MutationKindSchema,
  targetId: z.string().regex(/^[a-z0-9_]+$/).max(32),
  value: z.union([z.string().max(100), z.number().finite(), z.boolean()])
});

export const TurnResolutionSchema = z.object({
  version: z.literal("1.0"),
  interpretation: z.string().min(1).max(180),
  action: z.object({
    kind: ActionKindSchema,
    targetId: z.string().regex(/^[a-z0-9_]+$/).max(32).nullable()
  }),
  learnedConcepts: z.array(LearnedConceptSchema).max(4),
  mutations: z.array(MutationSchema).max(6),
  response: z.object({
    speaker: SpeakerSchema,
    text: z.string().min(1).max(220),
    emotion: z.enum(["afraid", "urgent", "confused", "relieved", "mimicking", "bureaucratic"])
  }),
  dangerDelta: z.number().int().min(-2).max(3),
  outcome: OutcomeSchema
});

export const WorldSnapshotSchema = z.object({
  callId: z.string().max(48),
  callIndex: z.number().int().min(0).max(9999),
  prologueBeat: z.number().int().min(0).max(12),
  danger: z.number().int().min(0).max(10),
  microphoneMode: z.enum(["push", "live", "muted"]),
  callerPosition: z.enum(["center", "door", "lamp", "mirror", "vent", "exit", "archive", "threshold", "utility", "observation", "stairwell"]),
  callerCoords: z.array(z.number()).max(3).optional(),
  mimicCoords: z.array(z.number()).max(3).optional(),
  doorsOpen: z.boolean(),
  powerOn: z.boolean(),
  mimicVisible: z.boolean(),
  awaitingSilence: z.boolean(),
  operatorCodename: z.string().min(1).max(24),
  vocabulary: z.array(z.string().max(24)).max(64),
  visibleEntityIds: z.array(z.string().regex(/^[a-z0-9_]+$/).max(32)).min(1).max(16),
  objective: ObjectiveSchema
});

export const TurnRequestSchema = z.object({
  frameDataUrl: z.string().regex(/^data:image\/(?:jpeg|webp);base64,/).max(1_200_000),
  transcript: z.string().min(1).max(240),
  state: WorldSnapshotSchema
});

export const GenerateCallRequestSchema = z.object({
  callIndex: z.number().int().min(1).max(9999),
  vocabulary: z.array(z.string().max(24)).max(64),
  previousOutcome: OutcomeSchema.optional()
});

export type CallBlueprint = z.infer<typeof CallBlueprintSchema>;
export type TurnResolution = z.infer<typeof TurnResolutionSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export type Mutation = z.infer<typeof MutationSchema>;
export type LearnedConcept = z.infer<typeof LearnedConceptSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;

export type LocationNode = {
  id: string;
  name: string;
  code: string;
  coords: [number, number, number];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  description: string;
  category: "sector" | "prop" | "hazard" | "exit";
};

export const LOCATION_SHEET: Record<string, LocationNode> = {
  center: {
    id: "center",
    name: "QUADRANT 00 // ARCHIVE CENTER FLOOR",
    code: "SEC-00",
    coords: [0, 0, 0.8],
    bounds: { minX: -1.5, maxX: 1.5, minZ: -0.5, maxZ: 1.8 },
    description: "Central chamber floor with tactical survey grid lines",
    category: "sector"
  },
  door: {
    id: "door",
    name: "SECTOR 01 // RED CONTAINMENT THRESHOLD",
    code: "SEC-01",
    coords: [-3.55, 0, -3.83],
    bounds: { minX: -4.4, maxX: -2.6, minZ: -4.0, maxZ: -3.5 },
    description: "Reinforced red steel threshold with heavy industrial frame",
    category: "prop"
  },
  red_door: {
    id: "red_door",
    name: "SECTOR 01 // RED CONTAINMENT DOOR",
    code: "SEC-01",
    coords: [-3.55, 0, -3.83],
    bounds: { minX: -4.4, maxX: -2.6, minZ: -4.0, maxZ: -3.5 },
    description: "The primary red door blocking exit from Archive Nine",
    category: "prop"
  },
  desk: {
    id: "desk",
    name: "OPERATOR CONSOLE & TERMINAL DESK",
    code: "PROP-DSK",
    coords: [0.2, 0, -0.7],
    bounds: { minX: -1.3, maxX: 1.6, minZ: -1.4, maxZ: 0.0 },
    description: "Heavy wooden terminal desk with cables and communication monitor",
    category: "prop"
  },
  radio: {
    id: "radio",
    name: "FIELD TRANSCEIVER RADIO",
    code: "PROP-RAD",
    coords: [0.65, 1.42, -0.7],
    bounds: { minX: 0.2, maxX: 1.1, minZ: -0.9, maxZ: -0.5 },
    description: "Narrowband radio unit on the desk receiving operator transmissions",
    category: "prop"
  },
  locker: {
    id: "locker",
    name: "STEEL EVIDENCE LOCKER 09",
    code: "PROP-LCK",
    coords: [3.8, 0, -3.3],
    bounds: { minX: 3.2, maxX: 4.4, minZ: -3.8, maxZ: -2.8 },
    description: "Tall industrial steel evidence locker bolted to the wall",
    category: "prop"
  },
  red_lamp: {
    id: "red_lamp",
    name: "CRIMSON WARNING ALARM LAMP",
    code: "PROP-LMP",
    coords: [2.7, 2.4, 0.2],
    bounds: { minX: 2.2, maxX: 3.2, minZ: -0.3, maxZ: 0.7 },
    description: "Ceiling-mounted red emergency beacon casting dynamic shadows",
    category: "prop"
  },
  mirror: {
    id: "mirror",
    name: "EAST SURVEILLANCE MIRROR",
    code: "PROP-MIR",
    coords: [4.86, 1.65, -1.8],
    bounds: { minX: 4.2, maxX: 5.0, minZ: -2.6, maxZ: -1.0 },
    description: "Full-height mirrored pane reflecting impossible room angles",
    category: "prop"
  },
  vent: {
    id: "vent",
    name: "LOW AIR INTAKE GRATE (VENT)",
    code: "PROP-VNT",
    coords: [-1.6, 0.65, -3.86],
    bounds: { minX: -2.3, maxX: -0.9, minZ: -4.0, maxZ: -3.5 },
    description: "Low-level steel intake duct along the north foundation wall",
    category: "prop"
  },
  clock: {
    id: "clock",
    name: "ANALOG TELEMETRY CLOCK",
    code: "PROP-CLK",
    coords: [0.2, 3.45, -3.85],
    bounds: { minX: -0.3, maxX: 0.7, minZ: -4.0, maxZ: -3.6 },
    description: "Archival clock recording unsaid time anomalies",
    category: "prop"
  },
  threshold: {
    id: "threshold",
    name: "SECTOR 01 // THRESHOLD APRON",
    code: "SEC-01",
    coords: [-4.1, 0, -1.5],
    bounds: { minX: -4.5, maxX: -3.0, minZ: -2.5, maxZ: -0.5 },
    description: "Approach zone directly leading to the red door",
    category: "sector"
  },
  utility: {
    id: "utility",
    name: "SECTOR 02 // GENERATOR & BREAKER ALCOVE",
    code: "SEC-02",
    coords: [3.1, 0, -2.4],
    bounds: { minX: 2.2, maxX: 4.0, minZ: -3.2, maxZ: -1.6 },
    description: "Substation alcove containing primary power relays",
    category: "sector"
  },
  observation: {
    id: "observation",
    name: "SECTOR 03 // SUPERVISORY MEZZANINE",
    code: "SEC-03",
    coords: [3.6, 0, 2.3],
    bounds: { minX: 2.8, maxX: 4.4, minZ: 1.5, maxZ: 3.2 },
    description: "Elevated platform overlooking the holding floor",
    category: "sector"
  },
  stairwell: {
    id: "stairwell",
    name: "SECTOR 04 // STAIRWELL SHAFT",
    code: "SEC-04",
    coords: [-3.1, 0, 2.5],
    bounds: { minX: -4.0, maxX: -2.2, minZ: 1.6, maxZ: 3.4 },
    description: "Dark concrete stair corridor descending into lower levels",
    category: "sector"
  },
  exit: {
    id: "exit",
    name: "SECTOR 09 // EXTRACTION AIRLOCK",
    code: "SEC-09",
    coords: [-4.0, 0, -1.6],
    bounds: { minX: -4.5, maxX: -3.4, minZ: -2.2, maxZ: -1.0 },
    description: "Personnel extraction pressure gate",
    category: "exit"
  }
};

export function buildControlSheet(state: WorldSnapshot, callerCoords?: [number, number, number]) {
  const coords = callerCoords || LOCATION_SHEET[state.callerPosition]?.coords || [0, 0, 0.8];
  return {
    operatorCodename: state.operatorCodename,
    currentSector: state.callerPosition,
    callerCoords: [Number(coords[0].toFixed(2)), Number(coords[1].toFixed(2)), Number(coords[2].toFixed(2))],
    doorsOpen: state.doorsOpen,
    powerOn: state.powerOn,
    mimicVisible: state.mimicVisible,
    availableActions: ["move", "inspect", "interact", "wait", "refuse"],
    destinations: Object.entries(LOCATION_SHEET).map(([key, item]) => {
      const dx = item.coords[0] - coords[0];
      const dz = item.coords[2] - coords[2];
      const distance = Math.hypot(dx, dz);
      return {
        id: key,
        name: item.name,
        code: item.code,
        coords: item.coords,
        distanceMeters: Number(distance.toFixed(2))
      };
    })
  };
}


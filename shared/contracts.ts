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
  learnedConcepts: z.array(LearnedConceptSchema).max(12),
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
  language: z.enum(["en", "hi"]).default("en"),
  steps: z.array(z.string().max(32)).max(8).default([]),
  signalChecked: z.boolean().default(false),
  callId: z.string().max(48),
  callIndex: z.number().int().min(0).max(9999),
  prologueBeat: z.number().int().min(0).max(12),
  danger: z.number().int().min(0).max(10),
  microphoneMode: z.enum(["push", "live", "muted"]),
  callerPosition: z.enum(["center", "door", "lamp", "mirror", "vent", "exit", "archive", "threshold", "utility", "observation", "stairwell"]),
  callerCoords: z.tuple([z.number().finite().min(-8).max(8), z.number().finite().min(-1).max(5), z.number().finite().min(-8).max(8)]).optional(),
  mimicCoords: z.tuple([z.number().finite().min(-8).max(8), z.number().finite().min(-1).max(5), z.number().finite().min(-8).max(8)]).optional(),
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
  transcript: z.string().trim().min(1).max(240),
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



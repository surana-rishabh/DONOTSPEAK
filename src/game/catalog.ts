import type { CallBlueprint, LearnedConcept } from "../../shared/contracts.js";

export const ENTITY_IDS = [
  "caller", "mimic", "red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock", "exit",
  "archive", "threshold", "utility", "observation", "stairwell"
] as const;

export const CONCEPT_POWERS: Record<string, Omit<LearnedConcept, "concept">> = {
  door: { powerClass: "threshold_travel", severity: 2 },
  open: { powerClass: "unseal", severity: 1 },
  light: { powerClass: "light_hunting", severity: 2 },
  shadow: { powerClass: "shadow_spawn", severity: 2 },
  mirror: { powerClass: "duplication", severity: 2 },
  voice: { powerClass: "voice_mimicry", severity: 2 },
  name: { powerClass: "identity_theft", severity: 3 },
  run: { powerClass: "acceleration", severity: 1 },
  look: { powerClass: "gaze_lock", severity: 1 },
  behind: { powerClass: "rear_ambush", severity: 2 },
  vent: { powerClass: "duct_crawl", severity: 1 },
  silence: { powerClass: "null_field", severity: 1 }
};

export const GOLDEN_CALL: CallBlueprint = {
  version: "1.0",
  seed: "archive-nine-prologue",
  caller: { name: "Mara Vale", voiceStyle: "controlled fear, close radio microphone" },
  layoutId: "archive",
  propIds: ["red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock"],
  objective: "escape",
  dangerousConcepts: ["door", "open", "name", "voice"],
  openingLine: "Control? I woke up in Archive Nine. I cannot see the room. Tell me where to go—but choose your words carefully.",
  operatorNotice: "SEMANTIC CONTAINMENT CALL 00. Do not supply nouns the caller does not already possess."
};

export const FALLBACK_CALLS: CallBlueprint[] = [
  {
    version: "1.0",
    seed: "utility-night-17",
    caller: { name: "Eli Rook", voiceStyle: "exhausted maintenance worker over a damaged intercom" },
    layoutId: "utility",
    propIds: ["red_door", "red_lamp", "mirror", "radio", "vent", "clock"],
    objective: "restore_power",
    dangerousConcepts: ["light", "shadow", "open"],
    openingLine: "The generator is dead and something keeps standing where my shadow should be. Talk me to the breaker.",
    operatorNotice: "Employee advisory: shadows are not approved substitute personnel."
  },
  {
    version: "1.0",
    seed: "observation-duplicate-4",
    caller: { name: "June Sable", voiceStyle: "dry wit masking panic, narrow-band telephone" },
    layoutId: "observation",
    propIds: ["red_door", "red_lamp", "mirror", "desk", "locker", "clock"],
    objective: "identify_caller",
    dangerousConcepts: ["mirror", "look", "voice"],
    openingLine: "There are two of me on the monitor. I would appreciate knowing which one receives my salary.",
    operatorNotice: "Payroll cannot process duplicate employees without Form 9-B or an exorcism receipt."
  },
  {
    version: "1.0",
    seed: "intake-mouth-2",
    caller: { name: "Noah Pike", voiceStyle: "fast-talking courier trying not to scream" },
    layoutId: "intake",
    propIds: ["red_door", "red_lamp", "desk", "locker", "radio", "vent"],
    objective: "trap_entity",
    dangerousConcepts: ["behind", "run", "vent"],
    openingLine: "The delivery crate is repeating directions before you say them. Please give me a route it cannot understand.",
    operatorNotice: "Do not sign for parcels that know your employee number."
  }
];


import type { CallBlueprint } from "../../shared/contracts.js";

export const ENTITY_IDS = [
  "caller", "mimic", "red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock", "exit",
  "archive", "threshold", "utility", "observation", "stairwell"
] as const;

export { CONCEPT_POWERS } from "../../shared/rules.js";

export const GOLDEN_CALL: CallBlueprint = {
  version: "1.0",
  seed: "archive-nine-prologue",
  caller: { name: "Mara Vale", voiceStyle: "controlled fear, close radio microphone" },
  layoutId: "archive",
  propIds: ["red_door", "red_lamp", "mirror", "desk", "locker", "radio", "vent", "clock"],
  objective: "escape",
  dangerousConcepts: ["door", "open", "name", "voice"],
  openingLine: "Control? I woke up in Archive Nine. I cannot see the room. Tell me where to go—but choose your words carefully.",
  operatorNotice: "Reach A, release the barrier there, then say proceed. Indirect descriptions keep the signal safe."
};

export const FALLBACK_CALLS: CallBlueprint[] = [
  {
    version: "1.0",
    seed: "utility-night-17",
    caller: { name: "Anika Rook", voiceStyle: "exhausted maintenance worker over a damaged intercom" },
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
    caller: { name: "Noor Pike", voiceStyle: "quiet courier trying not to scream" },
    layoutId: "intake",
    propIds: ["red_door", "red_lamp", "desk", "locker", "radio", "vent"],
    objective: "trap_entity",
    dangerousConcepts: ["behind", "run", "vent"],
    openingLine: "The delivery crate is repeating directions before you say them. Please give me a route it cannot understand.",
    operatorNotice: "Do not sign for parcels that know your employee number."
  }
];


---
name: do-not-say-world-compiler
description: Compile a surveillance image, spoken direction, and bounded game state into safe DO NOT SAY IT world mutations.
license: Apache-2.0
compatibility: Requires a multimodal model capable of strict JSON and Node.js 22 for the validator.
metadata:
  author: DO NOT SAY IT contributors
  version: "1.0"
---

# DO NOT SAY IT World Compiler

Use this skill when an agent must interpret a player's spoken direction against a surveillance frame and return bounded game-state changes.

## Inputs

1. A JPEG or WebP surveillance frame.
2. The committed speech transcript.
3. The current `WorldSnapshot`.
4. The exact list of visible entity IDs.

## Procedure

1. Inspect the frame to resolve indirect references such as “the opening below the red light.”
2. Choose one action: `move`, `inspect`, `interact`, `wait`, or `refuse`.
3. Never invent entity IDs. Use `null` when no visible target is grounded.
4. Teach concepts only when their exact word appears in the transcript.
5. Restrict concepts to `door`, `open`, `light`, `shadow`, `mirror`, `voice`, `name`, `run`, `look`, `behind`, `vent`, or `silence`.
6. Return only the `TurnResolution` JSON object described in `references/contracts.md`.
7. Run `node scripts/validate-turn.mjs turn.json` before accepting the result. A valid fixture is included at `examples/valid-turn.json`.

The model proposes. The deterministic engine validates and executes.


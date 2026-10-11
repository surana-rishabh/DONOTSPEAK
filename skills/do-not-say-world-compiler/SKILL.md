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
4. Understand English, Hindi and Hinglish. Derive concepts only from whole-word/phrase aliases in `shared/rules.ts`, never from the image or the model reply. Hindi spelling variants normalize with NFC.
5. Restrict concepts to `door`, `open`, `light`, `shadow`, `mirror`, `voice`, `name`, `run`, `look`, `behind`, `vent`, or `silence`.
6. The hosted model returns compact intent JSON (`kind`, `target`, `operation`, `reply`); the server maps it to the `TurnResolution` contract in `references/contracts.md`. Ground one action and one visible target. Never invent completion, danger changes or vocabulary. Reach a station before operating it; final confirmation/verdict must be a separate turn. Use a short calm female caller reply in the selected language.
7. Run `node --import tsx skills/do-not-say-world-compiler/scripts/validate-turn.mjs skills/do-not-say-world-compiler/examples/valid-turn.json` from the repository root. Schema validation is only the first check; `guardTurn` and the engine must validate transcript, target, proximity and objective gates before execution.

The model proposes. The deterministic engine validates and executes.


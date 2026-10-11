# TurnResolution contract

Required keys: `version`, `interpretation`, `action`, `learnedConcepts`, `mutations`, `response`, `dangerDelta`, and `outcome`.

- `version` is always `1.0`.
- `dangerDelta` is an integer from -2 through 3.
- `outcome` is `continue`, `escaped`, `caught`, or `identity_stolen`.
- Mutation kinds are limited to `open`, `close`, `power_on`, `power_off`, `reveal`, `hide`, `move_actor`, `spawn_shadow`, `swap_voice`, `camera_blackout`, `exit_success`, and `caller_caught`.
- Every action target must exist in `visibleEntityIds`; caller moves must use `STATION_POSITIONS`. Actor IDs and mutation kinds are guarded by shared rules.
- Responses contain a speaker, one short performable line, and an emotion.

The canonical machine-readable schemas live in `shared/contracts.ts`.

`learnedConcepts` may contain up to all 12 canonical concepts. Shared alias matching derives them from the original transcript; model-supplied learning/danger/outcomes are discarded. The engine counts new vocabulary and owns score/outcomes. No transcript is used to fine-tune model weights.

Objectives: A/release/proceed; B/activate/verify; C/inspect/trust-or-contain from the signal clue; D/wait/seal. Hindi/Hinglish equivalents share the same parser. Negated instructions cannot act, combined movement cannot interact, and interaction cannot confirm on the same turn. No silence countdown or forced live microphone exists.


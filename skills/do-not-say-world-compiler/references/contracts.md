# TurnResolution contract

Required keys: `version`, `interpretation`, `action`, `learnedConcepts`, `mutations`, `response`, `dangerDelta`, and `outcome`.

- `version` is always `1.0`.
- `dangerDelta` is an integer from -2 through 3.
- `outcome` is `continue`, `escaped`, `caught`, or `identity_stolen`.
- Mutation kinds are limited to `open`, `close`, `power_on`, `power_off`, `reveal`, `hide`, `move_actor`, `spawn_shadow`, `swap_voice`, `camera_blackout`, `exit_success`, and `caller_caught`.
- Every target ID must exist in the supplied `visibleEntityIds` array.
- Responses contain a speaker, one short performable line, and an emotion.

The canonical machine-readable schemas live in `shared/contracts.ts`.


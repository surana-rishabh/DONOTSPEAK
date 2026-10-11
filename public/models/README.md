# Model drop folder

Export binary glTF (`.glb`) with transforms applied, Y up, +Z forward, and the object origin at floor level unless noted. Keep textures embedded.

## Highest-impact files

1. `room_archive.glb` — complete surveillance room shell and large set dressing. Target 80k triangles or less.
2. `caller_mara.glb` — frightened human caller, neutral standing pose, origin between feet. Target 25k triangles.
3. `mimic_mara.glb` — corrupted double of Mara using the same proportions. Target 25k triangles.

## Optional prop replacements

- `red_door.glb` — centered on its hinge so it can rotate.
- `desk_terminal.glb`
- `locker_industrial.glb`
- `red_lamp.glb`
- `mirror_tall.glb`
- `radio_field.glb`
- `wall_vent.glb`
- `archive_clock.glb`

Only supplied caller/mimic GLBs are enabled and loaded. DRACO decoding is local in `public/draco/`. Characters are normalized to 1.75 m and recentered at their feet. The old room shell is disabled because its walls conflict with readable stations/cameras. Room/props are procedural, not generic manifest replacements. Failed character loads retain fallback actors and set canvas `data-models-error`, checked by QA. Replacing the room needs explicit camera/route calibration.

The supplied files have not been confirmed as redistributable. Verify their original authors and licenses before making a public submission. Use only assets you can redistribute under the repository license or document their separate license clearly.

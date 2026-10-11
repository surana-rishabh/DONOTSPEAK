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

The three supplied room and character GLBs are enabled. They use DRACO mesh compression, so the renderer loads the decoder from `public/draco/`. The room transform in `assets.json` is calibrated to the current surveillance scene; its floors and stairs remain visible, while interior wall meshes are hidden because they obscure the fixed cameras. Character meshes are recentered at their feet. Additional models can be enabled and tuned with `scale`, `position`, and `rotation`. A missing or disabled optional asset uses procedural fallback; a loading error is surfaced in the browser console and QA report.

The supplied files have not been confirmed as redistributable. Verify their original authors and licenses before making a public submission. Use only assets you can redistribute under the repository license or document their separate license clearly.

# Final Horror Polish Specification

The game should read as a restrained analog-surveillance horror experience, not a dashboard. Preserve every existing GLB file and its materials. Runtime wrapper transforms, shadows, and procedural room geometry may improve presentation without rewriting the assets.

The playable screen keeps only the objective/progress, exposure, current dialogue, input, camera choices, and a collapsed settings surface. Hints and learned vocabulary remain available on demand. Decorative instructions, route labels, permanent help copy, and incident history leave the normal play view.

The room gains full-height architectural walls, floor panels, ceiling structure, practical fixtures, fog, a cold key light, red emergency light, soft shadows, and a CRT presentation layer. CRT effects stay in DOM/CSS so Gemma receives a clean canvas capture. Existing models load in parallel and receive runtime shadow flags. The caller uses procedural idle and walking motion. Authored navigation stays deterministic and routes through a safe corridor instead of adding a physics dependency.

Audio uses layered procedural Web Audio ambience whose tension follows danger, mimic visibility, and game phase. Dialogue ducks ambience. Output speech uses ElevenLabs only; no browser default voice fallback. Callers, mimic, and operator receive distinct deterministic female voice identities, with optional per-role environment overrides. The request carries the caller character name so separate callers can receive separate voices.

The first transition from hidden mimic to visible mimic triggers a short mimic lunge and camera shock. Entering the ended phase triggers a caller lunge close to the active camera before the ending panel appears. Reduced-motion mode removes camera shake and lunges and reveals the result immediately.

No new runtime dependency is added. English, Hindi, Hinglish, typed input, push-to-talk, Plain view, captions, keyboard access, and the existing game-rule gates remain functional.

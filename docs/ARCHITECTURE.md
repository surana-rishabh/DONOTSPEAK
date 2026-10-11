# Architecture

Browser capture → server Scribe v2 → one transcript → Gemma intent → shared guard → pure engine → scene/captions → female TTS.

shared/contracts.ts is the schema boundary. shared/rules.ts owns bilingual aliases, locations, parser, fallback, and model guard. Server and browser use the same rules. src/game/engine.ts owns objective steps, exposure, vocabulary, score, and outcomes. Renderer reflects state; camera controls cannot move the logical caller.

Gemma interprets English/Hindi/Hinglish and a compressed screenshot. It proposes one intent, never a trusted outcome. Exact transcript aliases determine learning. Known commands override model mistakes. Unknown grounded directions can move only to listed destinations; interactions require proximity. The engine independently checks ordered steps and final keywords. Ended calls cannot be rescored.

Calls rotate through a fixed escape tutorial and three authored templates. Gemma may vary a bounded opening line, not invent levels, assets, code, or win conditions. Vocabulary persists; each newly named concept adds its severity, and repeated known concepts still add one exposure. Exposure resets per call. Learning is game state, not weight training; power classes describe risk rather than twelve separate monster animations.

Microphone access is explicit. Idle tracks are muted; one held recording lasts at most 15 seconds. Disconnect/new shift cancels pending work. Browser recognition supplies partial text or one fallback, not a second turn. Playback stops before recording. TTS requires female metadata; unavailable output falls back to a supported female browser voice or captions.

Three.js uses responsive resolution, four stable presets, orbit controls, authoritative stations, slow corridor travel, projected DOM anchors, and cleanup. Plain view replaces WebGL without changing rules; returning restores the logical caller location.

## Degraded modes

- Gemma timeout/outage: shared local rules; UI labels Local rules.
- Scribe unavailable: captured browser transcript if present, otherwise typed input.
- Female TTS unavailable: female browser voice if supported, otherwise captions/status.
- WebGL unavailable: typed rules/Plain view remain usable; visual grounding is unavailable.

Health flags mean credentials are configured, not recent provider success. Live smoke and turn responses provide that evidence.


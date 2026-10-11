# Architecture

## Trust boundary

The browser owns presentation and microphone capture. The Express server owns permanent provider credentials. Gemma output is always untrusted data.

1. `VoiceChannel` explicitly requests microphone permission. It attempts Scribe Realtime using a server-minted single-use token; if that transport fails, push-to-talk records a clip and the server sends it to Scribe v2 batch transcription.
2. A committed utterance is combined with a compressed Three.js frame and a bounded `WorldSnapshot`.
3. `WorldModelProvider` returns a candidate `TurnResolution`.
4. Zod checks structure; `enforceTurn` removes invented targets, derives concepts from exact transcript words, and clamps the response.
5. The pure game engine applies whitelisted mutations.

## Degraded modes

- Gemma unavailable: exact-word parser and authored fallbacks.
- ElevenLabs Realtime unavailable: recorded push-to-talk through Scribe v2; if transcription also fails, typed commands.
- ElevenLabs TTS unavailable: captions and browser speech.
- WebGL unavailable: the interface remains navigable, but the visual-grounding mechanic requires WebGL for live model turns.

## Procedural boundary

“Endless” calls do not generate arbitrary code or assets. Gemma composes `CallBlueprint` objects from four layouts, eight props, four objectives, and bounded language. The renderer also exposes five connected walkable sectors and five surveillance views; the compiler can move the caller only to listed sector IDs. This preserves replayability without giving a model control over rendering or execution.


# Threat model

## Protected assets

- Gemini and ElevenLabs API keys.
- User microphone audio and transcripts.
- Model execution budget.
- Browser state and rendered game world.

## Controls

- Provider keys remain in server environment variables.
- Realtime transcription uses expiring single-use tokens.
- No audio or transcript database exists.
- JSON bodies are capped at 2 MB and schema fields have strict length limits.
- In-memory per-IP throttling limits model and voice endpoints.
- Gemma receives only a low-resolution game frame, transcript, and bounded state—not the desktop or webcam.
- Model outputs are parsed with Zod, entity-target allowlists, finite mutation kinds, and bounded danger changes.
- Dynamic strings are rendered as React text, never injected as HTML.

## Known limitations

- ElevenLabs may retain provider-side data according to the account plan and configured provider policy.
- In-memory rate limits reset when the server restarts and should be replaced with a shared store for production-scale deployment.
- The self-hosted provider adapter trusts the configured endpoint operator with submitted frames and transcripts.


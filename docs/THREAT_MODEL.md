# Threat model

Protected: provider keys, microphone recordings/transcripts, paid inference budget, and player-visible game state.

- Keys stay in server environment variables. No audio/transcript database exists.
- Mic activation is explicit; idle tracks muted; disconnect aborts capture. Recordings capped at 15 seconds.
- Gemma receives only game frame/transcript/bounded snapshot, never desktop/webcam.
- Zod bounds strings, coordinates, targets, audio payloads, and proposals. Shared rules validate exact aliases/proximity; engine owns completion/score.
- JSON limit 2 MB; base64 limit 1.8 MB; MIME/base64 formats validated.
- Foreign host origins rejected. Per-IP throttling, expired bucket cleanup, bounded TTS cache. No raw provider bodies in errors.
- React strings rendered as text, not HTML. TTS responses no-store. Unknown API routes return JSON.
- Local server loopback by default; deployment explicitly binds externally.

## Limits

Local/demo game, not a hardened public multi-user backend. Client snapshots are not trusted competitive scores. Host-origin checks are not authentication and permit local dev ports. Limits are process-local and reset at restart. Public deployment needs authentication, account/provider budgets, trusted proxy configuration, persistent quotas.

Providers may retain data under their policies; browser recognition may use browser-vendor services. Self-hosted endpoints receive frames/transcripts. No multiplayer, penetration test, or deployment performed. Verify asset redistribution rights.


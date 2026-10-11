# DO NOT SAY IT

A slower, bilingual voice-controlled deduction game. Guide an unknown caller through four small objectives without giving the impostor dangerous words. English, Hindi, and Hinglish commands work; the caller speaks with a female voice.

The impostor's vocabulary is fictional game state, **not training or fine-tuning Gemma's weights**. Only exact dangerous words/aliases in your commands teach it; captions and AI replies do not.

## Play

| Call | Required steps | Safe example commands |
| --- | --- | --- |
| Escape | Reach A → release → confirm | Go to the red mark · Release the barrier · Proceed |
| Restore power | Reach B → activate → verify | Go to B · Activate the station · Verify |
| Identify caller | Reach C → inspect → decide from the clue | Go to C · Check the signal · Contain or Trust |
| Contain entity | Reach D → wait for it → seal | Go to D · Wait · Seal the area |

Hindi escape: `लाल निशान तक जाओ` → `रुकावट हटाओ` → `आगे`. Hinglish: `lal nishan tak jao` → `rukawat hatao` → `aage`.

No timer, automatic win, forced identity disclosure, or always-on microphone. One command does one action. Wait for arrival before the next instruction. Hints fill the editable textbox. Wrong identity decisions lose the signal; new dangerous words raise exposure by severity, and repeating a learned word adds one exposure. Vocabulary persists across calls, while exposure resets. At four exposure the mimic is revealed; at ten the signal is lost.

## Run locally

Node.js 22+ and current Chrome or Edge:

```bash
npm install
copy .env.example .env
npm run check:env
npm run dev
```

Open http://localhost:5173. Production: `npm run build`, then `npm start` at http://localhost:8080.

Add GEMINI_API_KEY and ELEVENLABS_API_KEY for live services. Without them, all objectives remain playable with typed commands and shared local rules. Click **Enable microphone**, grant permission, and speak naturally. About 900 ms of silence submits each spoken sentence; the microphone automatically resumes and stays enabled until toggled off (button or V). Capture temporarily pauses during caller playback, movement, processing, and hidden tabs to prevent echo and overlapping commands. Turning it off discards an unfinished recording and stops the input tracks. Each recording is capped at 15 seconds; silence alone is never sent. Use localhost or HTTPS.

## AI and voice

- Gemma 4 receives a small game screenshot, transcript, language, and bounded state. It proposes one semantic intent, including confirmation, inspection, staying, and verdicts. Unrecognized paraphrases can proceed at model confidence >= 0.40; that self-estimate is not a calibrated percentage of sentence similarity. Shared rules still enforce negation, visible targets, proximity, separate steps, dangerous words, and completion. Without Gemma, explicit English/Hindi/Hinglish aliases remain available.
- One MediaRecorder path sends each spoken utterance to Scribe v2 through the server. Local waveform energy detects the end of a sentence. Optional browser recognition supplies interim text and one fallback; it never independently submits duplicate turns. Device/noise calibration remains necessary for production.
- ElevenLabs metadata must identify the selected output as female. Default selection finds an available female voice; a configured male voice is not accepted. Flash v2.5 supports English/Hindi. On outage, captions are used; no default browser output voices. A quiet synthesized suspense pad sits below dialogue and ducks during speech/listening.
- Keys stay on the server. Recordings/transcripts are not persisted server-side. Provider-side policies still apply.

| Variable | Purpose |
| --- | --- |
| GEMINI_API_KEY | Hosted Gemma access |
| GEMMA_MODEL | Default gemma-4-26b-a4b-it |
| GEMMA_TURN_TIMEOUT_MS | Default 12000 ms; client deadline 15000 ms |
| ELEVENLABS_API_KEY | Scribe, TTS, voice metadata |
| ELEVENLABS_FEMALE_VOICE_ID | Optional preferred female ID, validated at runtime |
| ELEVENLABS_VOICE_ID | Legacy preferred ID, accepted only if female |
| ELEVENLABS_MODEL_ID | Default eleven_flash_v2_5 |
| ELEVENLABS_OUTPUT_FORMAT | Default mp3_44100_128 |
| HOST | Default 127.0.0.1; deployment uses 0.0.0.0 |

Self-hosted Gemma: GEMMA_BASE_URL, GEMMA_LOCAL_MODEL, optional GEMMA_LOCAL_API_KEY. Endpoint must support OpenAI-compatible multimodal JSON. Separately verify your chosen endpoint.

## Interface and scene

Four camera presets, drag orbit, wheel zoom, focused-canvas arrow/WASD panning, and reset affect the view—not game truth. A–D labels anchor to world positions. Drag or keyboard-adjust captions; swap panels/change console width in Layout. Small screens place captions below the scene. Plain view, captions, reduced motion, keyboard controls, and volume are available.

Caller/mimic GLBs use local DRACO decoding. A procedural low-wall room keeps stations visible; the old room shell is intentionally disabled. Asset redistribution rights remain unverified. See [model notes](public/models/README.md).

## Checks

```bash
npm run check
npm test
npm run build
npm run smoke:providers
npm run qa:voice
npm run qa:visual
npm run qa:visual:integrated
```

Browser QA requires Chrome at the path in the scripts. qa:visual tests a running server (QA_BASE_URL, default localhost:8080); integrated QA starts port 8491 after a build. QA_OUTPUT_DIR selects screenshot/report output. Microphone QA uses a simulated device/mocked transcript; provider smoke separately checks real female TTS and English/Hindi transcription.

See [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [demo](docs/DEMO_SCRIPT.md), and [world compiler skill](skills/do-not-say-world-compiler/SKILL.md).

## Deployment and license

Vercel production is at https://donotspeak.vercel.app. `vercel.json` serves the static build and routes `/api/*` to the Express function. Set `GEMINI_API_KEY` and `ELEVENLABS_API_KEY` as server environment variables (never `VITE_*`), plus the voice IDs from `.env.example` for your chosen character voices. Redeploy after changing environment variables. No separate API host is required. Browser QA verifies the hosted mobile escape route, model loading, named ending, and restart. Run `QA_BASE_URL=https://donotspeak.vercel.app node scripts/hosted-qa.mjs` to recheck; live provider features depend on production keys.

Phone rendering caps pixel ratio at 1, targets 30 fps outside scares, and disables dynamic shadow maps/antialiasing. Three.js loads only after clock-in. The opening portrait only tracks a fine mouse pointer and honors reduced motion; hidden tabs stop scene rendering. Existing model files are unchanged. Large model downloads still depend on the connection, and the API rate limiter is per function instance; add shared quota controls before an unrestricted public launch.

DigitalOcean manifest included; local verification is not deployment. Configure encrypted runtime keys. Public deployment needs authentication/provider quota controls and verified asset licenses. Apache-2.0 covers repository code; Gemma weights/services have separate terms. Generated audio is not committed.


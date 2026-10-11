# Final Horror Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the final low-chrome horror presentation pass with character-specific ElevenLabs voices, suspense audio, a dressed Three.js room, caller animation, safe movement, and two staged scares.

**Architecture:** Keep simulation rules unchanged. Add small pure policy modules for voice identity, audio tension, and safe routes; adapt the existing voice client, server endpoint, renderer, RoomView, App, and CSS around those contracts. Use built-in Three.js and Web Audio only.

**Tech Stack:** React 19, TypeScript, Vite, Three.js, Web Audio, ElevenLabs, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-final-horror-polish.md`

## Global Constraints

- Do not replace, delete, re-export, or modify files under `public/models/*.glb`.
- Do not add a runtime dependency.
- Do not change game-rule progression or keyword gates.
- Preserve English, Hindi, Hinglish, Plain view, captions, reduced motion, keyboard access, and typed input.
- Use ElevenLabs only for generated character speech; failure falls back to captions, not a browser default voice.

## Review Focus

- ElevenLabs account has one or zero female voices: fail clearly and preserve captions.
- Caller and mimic request the same character name: select different role identities when the account permits.
- Reduced-motion mode during reveal or ending: no lunge, camera shake, or delayed result.
- Model load partially fails: fallbacks remain and the game becomes playable.
- Small mobile viewport: input and objective stay usable without covering the scene.

---

### Task 1: Character Voice and Suspense Audio

**Files:**
- Create: `src/audio/audioDesign.ts`
- Create: `server/voiceProfiles.test.ts`
- Modify: `server/elevenLabs.ts`
- Modify: `server/index.ts`
- Modify: `src/audio/voice.ts`
- Modify: `src/App.tsx`
- Modify: `.env.example`

**Interfaces:**
- Produces: `chooseVoiceProfile(voices, speaker, character, configuredId?)`, `mixForTension(danger, mimicVisible, phase)`, `AmbientDirector.setTension(...)`, and character-aware `VoiceChannel.speak(...)`.
- Consumes: existing `/api/voice/stream` and `GameState`.

- [ ] Write tests proving role/character voice stability, caller/mimic separation, configured override, and audio tension/ducking values.
- [ ] Run `npm test` and verify the new tests fail because the policies do not exist.
- [ ] Implement the smallest voice-profile and audio-mix policies and wire the server/client lifecycle.
- [ ] Run `npm test && npm run check` and verify all tests pass.

### Task 2: Room, Navigation, Animation, and Scares

**Files:**
- Create: `src/render/scenePolicy.ts`
- Create: `server/scenePolicy.test.ts`
- Modify: `src/render/RoomRenderer.ts`
- Modify: `src/render/RoomView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `buildSafeRoute(from, to)`, `scareTransition(previous, next)`, renderer datasets/callbacks for reveal and ending.
- Consumes: `GameState`, station positions, existing model manifest, and Task 1 tension state.

- [ ] Write tests proving safe routes stay within room bounds, reveal fires once, ending scare is distinct, and reduced motion suppresses scare motion.
- [ ] Run `npm test` and verify failure because scene policy does not exist.
- [ ] Dress the room, enable measured shadows/fog, parallelize model loading, animate the caller, route movement through the safe corridor, and stage the two scares.
- [ ] Run `npm test && npm run check` and verify all tests pass.

### Task 3: Low-Chrome CRT Interface

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/render/RoomView.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 2 scare/renderer state and existing accessible controls.
- Produces: compact HUD, CRT feed treatment, delayed ending reveal, responsive/reduced-motion presentation.

- [ ] Update the visual QA expectations first so removed chrome and required compact controls fail against the old UI.
- [ ] Remove nonessential persistent text and panels; add the CRT layer, compact settings drawer, transitions, and scare overlay.
- [ ] Run `npm run check` and the integrated visual QA.

### Task 4: Full Verification and Review

**Files:**
- Modify: `scripts/visual-qa.mjs`
- Write artifacts: `outputs/`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: type/build/test evidence, screenshots, provider smoke evidence when configured, and an independent review.

- [ ] Run `npm test`, `npm run check`, and `npm run build`.
- [ ] Run `npm run qa:visual:integrated` and inspect desktop, mobile, every camera, reveal, and ending screenshots.
- [ ] Run `npm run smoke:providers` when provider credentials are configured.
- [ ] Request a fresh whole-change review, fix Important findings with RED to GREEN tests, and rerun the full suite.

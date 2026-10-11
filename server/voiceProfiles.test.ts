import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseVoiceProfile, type ElevenVoice } from "./elevenLabs.js";
import { mixForTension } from "../src/audio/audioDesign.js";

const voices: ElevenVoice[] = [
  { voice_id: "f-quiet", name: "Quiet", labels: { gender: "female" } },
  { voice_id: "f-clear", name: "Clear", labels: { gender: "female" } },
  { voice_id: "f-rough", name: "Rough", labels: { gender: "female" } },
  { voice_id: "m-default", name: "Default", labels: { gender: "male" } }
];

test("character voice identity is stable and role-specific", () => {
  const caller = chooseVoiceProfile(voices, "caller", "Mara Vale");
  assert.deepEqual(chooseVoiceProfile(voices, "caller", "Mara Vale"), caller);
  assert.notEqual(chooseVoiceProfile(voices, "mimic", "Mara Vale").voiceId, caller.voiceId);
  assert.notEqual(caller.voiceId, "m-default");
});

test("configured custom voice overrides deterministic selection", () => {
  assert.equal(chooseVoiceProfile(voices, "operator", "Nightjar", "f-rough").voiceId, "f-rough");
});

test("configured custom voices must exist and remain female", () => {
  assert.throws(() => chooseVoiceProfile(voices, "caller", "Mara Vale", "m-default"), /female voice/i);
  assert.throws(() => chooseVoiceProfile(voices, "caller", "Mara Vale", "missing"), /configured voice/i);
});

test("voice selection refuses an account without a female voice", () => {
  assert.throws(() => chooseVoiceProfile(voices.slice(-1), "caller", "Mara Vale"), /female voice/i);
});

test("suspense mix rises with danger and ducks under dialogue", () => {
  const calm = mixForTension(0, false, "active", false);
  const danger = mixForTension(8, true, "active", false);
  const ducked = mixForTension(8, true, "active", true);
  assert.ok(danger.pulse > calm.pulse);
  assert.ok(danger.noise > calm.noise);
  assert.ok(danger.impactRate > calm.impactRate);
  assert.ok(ducked.drone < danger.drone);
  assert.ok(ducked.pulse < danger.pulse);
});

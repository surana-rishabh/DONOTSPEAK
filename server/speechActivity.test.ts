import test from "node:test";
import assert from "node:assert/strict";
import { sampleSpeech } from "../src/audio/speechActivity.js";

test("continuous microphone sends a spoken sentence after silence, not silence or a brief click", () => {
  const activity = { voicedMs: 0, lastVoice: 0, lastSample: 0 };
  for (let now = 60; now < 3000; now += 60) assert.equal(sampleSpeech(activity, 0.002, now), false);
  assert.equal(sampleSpeech(activity, 0.04, 3000), false);
  assert.equal(sampleSpeech(activity, 0, 4000), false);
  for (let now = 4060; now <= 4600; now += 60) assert.equal(sampleSpeech(activity, 0.06, now), false);
  assert.equal(sampleSpeech(activity, 0, 4900), false);
  assert.equal(sampleSpeech(activity, 0, 5500), true);
});

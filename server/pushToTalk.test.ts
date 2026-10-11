import assert from "node:assert/strict";
import test from "node:test";
import { describeMicrophoneAccessError, diagnoseMicrophoneEnvironment, finishPushToTalk, waitForMicrophoneReady } from "../src/audio/pushToTalk.js";

test("push-to-talk commits buffered speech before muting the microphone", () => {
  const events: string[] = [];
  let scheduledDelay = 0;
  finishPushToTalk(
    { commit: () => events.push("commit"), mute: () => events.push("mute") },
    (callback, delay) => {
      scheduledDelay = delay;
      events.push("scheduled");
      callback();
      return 1;
    }
  );

  assert.deepEqual(events, ["commit", "scheduled", "mute"]);
  assert.equal(scheduledDelay, 180);
});

test("microphone diagnostics explain browser secure-context requirements", () => {
  assert.match(
    diagnoseMicrophoneEnvironment({ isSecureContext: false, hasGetUserMedia: false, hostname: "192.168.1.10" }) ?? "",
    /HTTPS|localhost/
  );
  assert.equal(
    diagnoseMicrophoneEnvironment({ isSecureContext: true, hasGetUserMedia: true, hostname: "example.test" }),
    null
  );
});

test("microphone readiness waits for the browser track instead of trusting session start", async () => {
  let checks = 0;
  const ready = await waitForMicrophoneReady(
    () => ++checks >= 3,
    async () => undefined,
    5
  );

  assert.equal(ready, true);
  assert.equal(checks, 3);
});

test("microphone permission failures provide a recovery action", () => {
  assert.match(describeMicrophoneAccessError({ name: "NotAllowedError" }), /site settings|address bar/i);
  assert.match(describeMicrophoneAccessError({ name: "NotFoundError" }), /no microphone/i);
  assert.match(describeMicrophoneAccessError({ name: "NotReadableError" }), /another application|Windows/i);
});

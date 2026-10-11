import { chromium } from "playwright-core";
import assert from "node:assert/strict";

process.env.PORT = "8492";
const { server } = await import("../server/index.ts");
let browser;
try {
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-webgl"]
  });
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); const errors = []; let recordings = 0;
  await page.addInitScript(() => {
    window.voiceQAenergy = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      window.voiceQAstream = stream;
      if (window.voiceQAdelay) await new Promise(resolve => setTimeout(resolve, 600));
      return stream;
    };
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples) { samples.fill(window.voiceQAenergy); };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: false } }));
  await page.route("**/api/voice/stream", (route) => route.fulfill({ status: 503, json: { error: "Test captions fallback" } }));
  await page.route("**/api/voice/transcribe", (route) => {
    const data = route.request().postDataJSON();
    assert.ok(data.base64.length > 300); assert.match(data.mimeType, /^audio\//); assert.equal(data.language, "en");
    recordings++; return route.fulfill({ json: { text: recordings === 1 ? "Go to B" : "Go to A" } });
  });
  await page.goto("http://localhost:8492/", { waitUntil: "networkidle" });
  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.locator(".settings-drawer summary").click();
  await page.getByLabel("Reduced motion", { exact: true }).check();
  await page.locator(".settings-drawer summary").click();
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Turn microphone off / V", exact: true });
  await toggle.waitFor();
  await page.waitForFunction(() => document.querySelector(".mic-status")?.textContent === "Listening");
  await page.waitForTimeout(1200); assert.equal(recordings, 0, "Silence must not be submitted");
  for (const [text, x] of [["Go to B", "3.10"], ["Go to A", "-3.55"]]) {
    await page.evaluate(() => { window.voiceQAenergy = 0.07; });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.voiceQAenergy = 0; });
    await page.waitForFunction(text => document.querySelector(".transcript-line")?.textContent === text, text);
    await page.waitForFunction(x => document.querySelector("canvas")?.dataset.callerX === x, x);
    await page.waitForFunction(() => document.querySelector(".mic-status")?.textContent === "Listening");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  }
  assert.equal(recordings, 2);
  await page.evaluate(() => { window.voiceQAenergy = 0.07; });
  await page.waitForTimeout(300);
  await toggle.click();
  await page.evaluate(() => { window.voiceQAenergy = 0; });
  await page.waitForTimeout(1200); assert.equal(recordings, 2, "Toggle-off discards unfinished speech");
  assert.equal(await page.getByRole("button", { name: "Enable microphone", exact: true }).count(), 1);
  await page.keyboard.press("v"); await toggle.waitFor();
  await page.keyboard.press("v");
  await page.getByRole("button", { name: "Enable microphone", exact: true }).waitFor();
  await page.evaluate(() => { window.voiceQAdelay = true; });
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  await page.getByRole("button", { name: "Cancel microphone", exact: true }).click();
  await page.waitForFunction(() => window.voiceQAstream?.getAudioTracks().every(track => track.readyState === "ended"));
  assert.equal(await page.getByRole("button", { name: "Enable microphone", exact: true }).getAttribute("aria-pressed"), "false");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, microphone: "simulated continuous capture + energy", transcription: "mocked", submissions: recordings, autoResume: true, silenceIgnored: true, toggleOff: true, keyboardToggle: true, cancelPendingPermission: true }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser?.close(); server.close(); }

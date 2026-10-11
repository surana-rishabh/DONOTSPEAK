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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: false } }));
  await page.route("**/api/voice/stream", (route) => route.fulfill({ status: 503, json: { error: "Test captions fallback" } }));
  await page.route("**/api/voice/transcribe", (route) => {
    const data = route.request().postDataJSON();
    assert.ok(data.base64.length > 300); assert.match(data.mimeType, /^audio\//); assert.equal(data.language, "en");
    recordings++; return route.fulfill({ json: { text: "Go to B" } });
  });
  await page.goto("http://localhost:8492/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.locator(".settings-drawer summary").click();
  await page.getByLabel("Reduced motion", { exact: true }).check();
  await page.locator(".settings-drawer summary").click();
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  const talk = page.getByRole("button", { name: "Hold to speak / V", exact: true });
  await talk.waitFor(); const box = await talk.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".transcript-line")?.textContent === "Go to B");
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.callerX === "3.10");
  assert.equal(recordings, 1);
  await page.getByRole("button", { name: "Disconnect mic", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Enable microphone", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, microphone: "simulated capture", transcription: "mocked", submissions: recordings, destination: "B", disconnect: true }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser?.close(); server.close(); }

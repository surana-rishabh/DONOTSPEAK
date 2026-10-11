import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const output = process.env.QA_OUTPUT_DIR || new URL("../outputs/", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
await mkdir(output, { recursive: true });
let localServer;
if (process.env.QA_START_SERVER === "1") {
  process.env.PORT = "8491";
  localServer = (await import("../server/index.ts")).server;
}
const base = process.env.QA_BASE_URL || (localServer ? "http://localhost:8491" : "http://localhost:8080");
let browser;
const errors = []; const events = []; const checks = [];
let page;
try {
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-webgl"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR")) errors.push(message.text());
    if (message.type() === "warning" && message.text().includes("ElevenLabs playback")) console.warn(message.text());
  });
  page.on("response", (response) => { if (response.url().includes("/api/turns/resolve")) void response.json().then((data) => events.push({ source: data.source, durationMs: data.durationMs })); });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${output}/game-intro.png`, fullPage: true });
  assert.equal(await page.getByRole("button", { name: /clock in/i }).isDisabled(), true);
  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).click(); await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true", null, { timeout: 20000 });
  assert.equal(await page.locator("canvas").getAttribute("data-models-error"), null);
  assert.equal(await page.locator("canvas").getAttribute("data-model-failures"), "0");
  assert.equal(await page.locator("canvas").getAttribute("data-model-count"), "10");
  assert.equal(await page.locator(".hud-cluster").count(), 1);
  assert.equal(await page.locator(".crt-overlay").count(), 1);
  assert.equal(await page.locator(".incident-log, .camera-help, .route-list").count(), 0);
  checks.push("Low-chrome HUD and CRT feed");
  await page.screenshot({ path: `${output}/game-desktop.png`, fullPage: true });
  const openSettings = async () => { if (await page.locator(".settings-drawer").getAttribute("open") === null) await page.locator(".settings-drawer summary").click(); };
  const closeSettings = async () => { if (await page.locator(".settings-drawer").getAttribute("open") !== null) await page.locator(".settings-drawer summary").click(); };
  await openSettings();
  await page.getByLabel("Reduced motion", { exact: true }).check();
  await closeSettings();
  const send = async (text, expectedScare) => {
    await page.waitForFunction(() => !document.querySelector("#command")?.disabled, null, { timeout: 25000 });
    await page.locator("#command").fill(text); await page.getByRole("button", { name: /^(send|भेजें)$/i }).click();
    if (expectedScare) {
      await page.waitForFunction((kind) => document.querySelector("canvas")?.dataset.scare === kind, expectedScare, { timeout: 25000 });
      await page.waitForTimeout(expectedScare === "mimic" ? 330 : 420);
      await page.screenshot({ path: `${output}/scare-${expectedScare}.png`, fullPage: true });
    }
    await page.waitForFunction(() => Boolean(document.querySelector(".ending-panel")) || !document.querySelector("#command")?.disabled, null, { timeout: 25000 });
  };
  await send("Proceed"); assert.equal(await page.locator(".ending-panel").count(), 0);
  await send("Go to the red mark"); assert.match(await page.locator(".objective-steps").innerText(), /✓\s*Reach A/);
  await page.getByText("Caller speaking", { exact: true }).waitFor({ state: "hidden", timeout: 25000 });
  assert.doesNotMatch(await page.locator(".voice-detail").innerText(), /Voice output unavailable/);
  checks.push("Latest voice reply plays without stale cancellation errors");
  await send("Release the barrier"); assert.equal(await page.locator(".ending-panel").count(), 0);
  await send("Proceed"); await page.locator(".ending-panel").waitFor(); checks.push("English escape + premature confirmation blocked");
  await page.screenshot({ path: `${output}/game-success.png`, fullPage: true });
  for (const commands of [["Go to B", "Activate the station", "Verify"], ["Go to C", "Check the signal", "Contain"], ["Go to D", "Wait", "Seal the area"]]) {
    await page.getByRole("button", { name: "Next call", exact: true }).click(); await page.getByRole("button", { name: /answer call/i }).click();
    if (commands[0] === "Go to D") { await openSettings(); await page.getByLabel("Reduced motion", { exact: true }).uncheck(); await closeSettings(); }
    for (const command of commands) await send(command, command === "Wait" ? "mimic" : command === "Seal the area" ? "caller" : undefined);
    assert.match(await page.locator(".ending-panel").innerText(), /Signal secured/i); checks.push(commands.join(" → "));
  }
  checks.push("Mimic reveal and caller ending scares");
  await page.getByRole("button", { name: "New shift", exact: true }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("hi");
  await page.locator("#codename").fill("निशा");
  await page.getByRole("button", { name: /खेल शुरू करें/ }).click(); await page.getByRole("button", { name: /कॉल उठाएँ/ }).click();
  await openSettings();
  await page.getByLabel("कम गति", { exact: true }).check();
  await closeSettings();
  for (const text of ["लाल निशान तक जाओ", "रुकावट हटाओ", "आगे"]) await send(text);
  assert.match(await page.locator(".ending-panel").innerText(), /सिग्नल सुरक्षित/); checks.push("Hindi escape + keyword gate");
  await page.getByRole("button", { name: "नई शिफ्ट", exact: true }).click(); await page.getByLabel("भाषा", { exact: true }).selectOption("en");
  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).click(); await page.getByRole("button", { name: /answer call/i }).click();
  await page.locator("canvas").waitFor(); await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true");
  await openSettings();
  await page.getByLabel("Reduced motion", { exact: true }).uncheck();
  await closeSettings();
  for (const name of ["02Threshold", "03Overhead", "04Follow", "01Overview"]) {
    const index = Number(name.slice(0, 2)) - 1; await page.locator(".camera-deck button").nth(index).click();
    await page.screenshot({ path: `${output}/camera-${index}.png`, fullPage: true });
  }
  checks.push("All camera presets");
  const canvasBox = await page.locator("canvas").boundingBox();
  const before = await page.locator("canvas").screenshot();
  await page.mouse.move(canvasBox.x + canvasBox.width * .6, canvasBox.y + canvasBox.height * .5); await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * .7, canvasBox.y + canvasBox.height * .55, { steps: 10 }); await page.mouse.up();
  const after = await page.locator("canvas").screenshot(); assert.notEqual(Buffer.compare(before, after), 0); checks.push("Orbit changes the rendered camera");
  const handle = page.getByRole("button", { name: "Drag caption panel", exact: true }); const box = await handle.boundingBox();
  const prior = await page.locator(".caption-card").getAttribute("style");
  await page.mouse.move(box.x + box.width / 2, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y - 110, { steps: 10 }); await page.mouse.up();
  assert.notEqual(await page.locator(".caption-card").getAttribute("style"), prior); checks.push("Caption panel drag");
  await page.locator("canvas").evaluate((node) => { node.dataset.qaIdentity = "preserved"; });
  await openSettings(); await page.getByLabel("Plain view", { exact: true }).check(); await closeSettings();
  await send("Go to A"); assert.match(await page.locator(".plain-room").innerText(), /Caller at: door/);
  await send("Release the barrier"); await send("Proceed"); await page.locator(".ending-panel").waitFor();
  await page.getByRole("button", { name: "Next call", exact: true }).click(); await page.getByRole("button", { name: /answer call/i }).click();
  await openSettings(); await page.getByLabel("Plain view", { exact: true }).uncheck(); await closeSettings();
  assert.equal(await page.locator("canvas").getAttribute("data-qa-identity"), "preserved");
  await page.waitForTimeout(1200); assert.equal(await page.locator("canvas").getAttribute("data-scare"), null);
  checks.push("Plain view remains playable, preserves models, and does not defer scares");
  for (const [width, height] of [[390, 844], [768, 1024], [1366, 768]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}`);
    await page.screenshot({ path: `${output}/game-${width}.png`, fullPage: true });
  }
  checks.push("390 / 768 / 1366 layouts without horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 900 });
  let recordings = 0;
  await page.route("**/api/voice/transcribe", (route) => {
    const data = route.request().postDataJSON(); assert.ok(data.base64.length > 300); recordings++;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"text":"Go to B"}' });
  });
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  await page.getByRole("button", { name: "Turn microphone off / V", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".mic-status")?.textContent === "Listening");
  await page.evaluate(() => {
    window.visualVoiceEnergy = 0.07;
    AnalyserNode.prototype.getFloatTimeDomainData = function(samples) { samples.fill(window.visualVoiceEnergy); };
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.visualVoiceEnergy = 0; });
  await page.waitForFunction(() => document.querySelector(".transcript-line")?.textContent === "Go to B", null, { timeout: 20000 });
  assert.equal(recordings, 1); checks.push("Simulated microphone capture submits once, recorded STT response drives game");
  await page.getByRole("button", { name: "Turn microphone off / V", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Enable microphone", exact: true }).count(), 1); checks.push("Microphone disconnect");
  assert.deepEqual(errors, []); assert.ok(events.some((e) => e.source === "gemma" || e.source === "self-hosted"), "No live Gemma turns were verified");
  console.log(JSON.stringify({ ok: true, checks, events, errors }, null, 2));
} catch (error) {
  errors.push(error.message); console.error(error); process.exitCode = 1;
  if (page && !page.isClosed()) { await page.screenshot({ path: `${output}/qa-failure.png`, fullPage: true }); await writeFile(`${output}/qa-failure.txt`, await page.locator("body").innerText()); }
}
finally { await writeFile(`${output}/qa-report.json`, JSON.stringify({ checks, events, errors }, null, 2)); await browser?.close(); localServer?.close(); }

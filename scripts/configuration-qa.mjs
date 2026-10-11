import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage(); const warnings = []; let speechRequests = 0;
  page.on("console", message => { if (/Unknown extension|Shader Error|not a property/.test(message.text())) warnings.push(message.text()); });
  page.on("pageerror", error => warnings.push(error.message));
  await page.route("**/api/health", route => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: false } }));
  await page.route("**/api/voice/stream", route => { speechRequests++; return route.fulfill({ status: 503, json: { error: "ELEVENLABS_API_KEY is not configured" } }); });
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  assert.equal(await page.locator('meta[name="mobile-web-app-capable"]').getAttribute("content"), "yes");
  await page.locator("#codename").fill("CONFIG-QA");
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true", null, { timeout: 60000 });
  await page.waitForTimeout(500);
  assert.match(await page.locator(".voice-detail").innerText(), /ELEVENLABS_API_KEY.*Production/);
  assert.equal(speechRequests, 0);
  assert.equal(await page.locator("canvas").getAttribute("data-model-failures"), "0");
  assert.deepEqual(warnings, []);
  await page.unroute("**/api/health");
  await page.route("**/api/health", route => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: true } }));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#codename").fill("ERROR-QA");
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector(".voice-detail")?.textContent?.includes("ELEVENLABS_API_KEY is not configured"));
  assert.equal(speechRequests, 1);
  assert.deepEqual(warnings, []);
  console.log(JSON.stringify({ ok: true, missingConfigurationDetected: true, noFailedSpeechRequests: true, legacyMaterialsCompile: true, unchangedModelsLoad: true, modernMobileMetadata: true }));
} finally { await browser.close(); }

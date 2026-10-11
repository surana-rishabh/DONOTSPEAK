import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto("http://127.0.0.1:5173");
  await desktop.waitForFunction(() => document.querySelector(".shadow-portrait img")?.naturalWidth > 0);
  await desktop.mouse.move(1400, 850);
  await desktop.waitForFunction(() => parseFloat(document.querySelector(".shadow-portrait").style.getPropertyValue("--portrait-x")) > 0);
  await desktop.screenshot({ path: "outputs/intro-portrait-desktop.png" });
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  await desktop.waitForTimeout(200);
  await desktop.mouse.move(10, 10);
  assert.equal(await desktop.locator(".shadow-portrait").evaluate(node => node.style.getPropertyValue("--portrait-x")), "0px");

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/health", route => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: false } }));
  await page.route("**/api/voice/stream", route => route.fulfill({ status: 503, json: { error: "Caption-only layout test" } }));
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => document.querySelector(".shadow-portrait img")?.naturalWidth > 0);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Intro overflow at ${width}`);
    const button = await page.getByRole("button", { name: /clock in/i }).boundingBox();
    assert.ok(button.height >= 44);
    await page.screenshot({ path: `outputs/intro-portrait-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".shadow-portrait").evaluate(node => node.style.getPropertyValue("--portrait-x")), "");
  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).tap();
  await page.getByRole("button", { name: /answer call/i }).tap();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true", null, { timeout: 30000 });
  assert.equal(await page.locator("canvas").getAttribute("data-model-failures"), "0");
  assert.equal(await page.locator("canvas").getAttribute("data-webgl-error"), null);
  assert.ok(await page.locator("canvas").evaluate(node => node.width <= node.getBoundingClientRect().width + 1));
  assert.equal(await page.locator("#command").evaluate(node => getComputedStyle(node).fontSize), "16px");
  for (const width of [320, 390, 768, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Game overflow at ${width}`);
    await page.screenshot({ path: `outputs/game-mobile-polish-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#command").fill("Go to B");
  await page.getByRole("button", { name: "Send", exact: true }).tap();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.walking === "false" && document.querySelector("canvas")?.dataset.callerX === "3.10", null, { timeout: 15000 });
  for (const command of ["Go to A", "Release it", "Go ahead"]) {
    await page.locator("#command").fill(command);
    await page.getByRole("button", { name: "Send", exact: true }).tap();
    if (command === "Go to A") await page.waitForFunction(() => document.querySelector("canvas")?.dataset.walking === "false" && document.querySelector("canvas")?.dataset.callerX === "-3.55", null, { timeout: 15000 });
  }
  await page.locator(".ending-panel").waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, portrait: true, mouseParallax: true, reducedMotion: true, touchStatic: true, mobileDpr: 1, mobileMovement: true, mobileCallCompletion: true, sizes: [320, 390, 768, 844], pageErrors: errors }));
} finally { await browser.close(); }

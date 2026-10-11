import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(async () => {
    const { AmbientDirector } = await import("/src/audio/voice.ts");
    window.bgmQA = new AmbientDirector();
    const start = document.createElement("button"); start.textContent = "Start audio test";
    start.onclick = async () => { await window.bgmQA.start(0.65); window.bgmQA.setTension(0, false, "briefing", false); };
    document.body.append(start);
  });
  await page.getByRole("button", { name: "Start audio test" }).click();
  assert.equal(await page.evaluate(() => window.bgmQA.track.paused), true);
  await page.evaluate(() => window.bgmQA.setTension(0, false, "active", false));
  await page.waitForFunction(() => window.bgmQA.track.currentTime > 0.1 && !window.bgmQA.track.paused);
  assert.equal(await page.evaluate(() => window.bgmQA.track.loop), true);
  await page.waitForTimeout(700);
  const normal = await page.evaluate(() => window.bgmQA.trackGain.gain.value);
  await page.evaluate(() => window.bgmQA.setTension(0, false, "active", true));
  await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => window.bgmQA.trackGain.gain.value) < normal);
  await page.evaluate(() => window.bgmQA.setVolume(0)); await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => window.bgmQA.master.gain.value) < 0.003);
  await page.evaluate(() => window.bgmQA.setTension(0, false, "ended", false));
  assert.equal(await page.evaluate(() => window.bgmQA.track.paused), true);
  await page.evaluate(() => window.bgmQA.stop());
  assert.equal(await page.evaluate(() => window.bgmQA.track), null);
  console.log(JSON.stringify({ ok: true, actualMp3Playback: true, loops: true, dialogueDucking: true, mute: true, stopsAtEnding: true, cleanup: true }));
} finally { await browser.close(); }

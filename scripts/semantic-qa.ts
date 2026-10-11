import "dotenv/config";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { resolveWorldTurn } from "../server/worldCompiler.js";
import { applyResolution, beginCall, createInitialState, fallbackResolution, markResolving, snapshot, startGoldenCall } from "../src/game/engine.js";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  const frameDataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    canvas.getContext("2d")!.fillRect(0, 0, 64, 64); return canvas.toDataURL("image/jpeg");
  });
  let ready = beginCall(startGoldenCall(createInitialState(), "QA"));
  for (const text of ["Go to A", "Release the barrier"]) { ready = markResolving(ready, text); ready = applyResolution(ready, fallbackResolution(ready, text)); }
  for (const text of ["you have my permission to take the next step", "अब तुम वहाँ से निकल सकते हो", "ab tum wahan se nikal sakte ho", "not yet, remain where you are"]) {
    const pending = markResolving(ready, text);
    const result = await resolveWorldTurn({ frameDataUrl, transcript: text, state: snapshot(pending) });
    const next = applyResolution(pending, result.resolution);
    assert.equal(next.outcome, text.startsWith("not") ? null : "escaped", `${text}: ${result.resolution.response.text}`);
    console.log(JSON.stringify({ language: text, source: result.source, confidence: result.resolution.semanticIntent?.confidence, outcome: next.outcome }));
  }
} finally { await browser.close(); }

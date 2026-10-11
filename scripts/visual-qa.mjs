import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";

if (process.env.QA_START_SERVER === "1") {
  const port = process.env.QA_PORT || "8488";
  process.env.PORT = port;
  const host = Object.values(networkInterfaces()).flat().find((address) => address?.family === "IPv4" && !address.internal)?.address || "127.0.0.1";
  process.env.QA_BASE_URL = `http://${host}:${port}/`;
  await import("../server/index.ts");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const output = `${root.replace(/\/$/, "")}/outputs`;
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--unsafely-treat-insecure-origin-as-secure=${(process.env.QA_BASE_URL || "http://127.0.0.1:8080/").replace(/\/$/, "")}`,
    "--enable-webgl",
    "--ignore-gpu-blocklist"
  ]
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["microphone"] });
const page = await context.newPage();
const issues = [];
const providerEvents = [];
const providerReads = [];
page.on("console", (message) => { if (["error", "warning"].includes(message.type())) issues.push({ type: `console:${message.type()}`, text: message.text() }); });
page.on("pageerror", (error) => issues.push({ type: "pageerror", text: error.message }));
page.on("response", (response) => {
  if (response.status() >= 400) issues.push({ type: "http", status: response.status(), url: response.url().replace(/\?.*$/, "") });
  if (response.ok() && new URL(response.url()).pathname === "/api/voice/stream") {
    providerEvents.push({ endpoint: "/api/voice/stream", source: "elevenlabs", durationMs: 0 });
  }
  if (response.ok() && /\/api\/(turns\/resolve|calls\/generate)$/.test(new URL(response.url()).pathname)) {
    providerReads.push(response.json().then((body) => providerEvents.push({
      endpoint: new URL(response.url()).pathname,
      source: body.source || "unknown",
      durationMs: Number(body.durationMs || 0)
    })).catch(() => undefined));
  }
});

try {
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.screenshot({ path: `${output}/dnsi-onboarding-1440.png`, fullPage: true });

  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector(".surveillance-canvas")?.dataset.modelsReady === "true", null, { timeout: 10_000 }).catch(async () => {
    issues.push({ type: "models", text: await page.locator(".surveillance-canvas").getAttribute("data-models-error") || "Model loading timed out" });
  });
  try {
    await page.waitForFunction(
      () => document.querySelector(".transmission .section-title b")?.textContent?.trim() === "MUTED",
      null,
      { timeout: 10_000 }
    );
  } catch {
    issues.push({ type: "microphone", text: `Realtime microphone never became ready: ${await page.locator(".voice-detail").textContent().catch(() => "no detail")}` });
  }
  if ((await page.locator("body").innerText()).includes("Audio playback unavailable")) issues.push({ type: "audio", text: "TTS response could not be decoded or played" });
  await page.screenshot({ path: `${output}/dnsi-call-1440.png`, fullPage: true });
  for (const camera of ["CAM 03", "CAM 04", "CAM 05"]) {
    await page.getByRole("button", { name: new RegExp(camera) }).click();
    await page.screenshot({ path: `${output}/dnsi-${camera.toLowerCase().replace(" ", "-")}-1440.png`, fullPage: true });
  }
  await page.getByRole("button", { name: /CAM 01/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/dnsi-call-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const typed = page.getByPlaceholder("Typed fallback command…");
  await typed.fill("Open the red door");
  await page.getByRole("button", { name: "SEND" }).click();
  await page.waitForFunction(() => !document.querySelector(".game-shell")?.classList.contains("phase-resolving"), null, { timeout: 12_000 });
  await page.screenshot({ path: `${output}/dnsi-breach-1440.png`, fullPage: true });

  await typed.fill("Who are you");
  await page.getByRole("button", { name: "SEND" }).click();
  await page.waitForFunction(() => !document.querySelector(".game-shell")?.classList.contains("phase-resolving"), null, { timeout: 12_000 });
  await page.waitForSelector(".ending-panel", { timeout: 10_000 });
  await page.screenshot({ path: `${output}/dnsi-ending-1440.png`, fullPage: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: `${output}/dnsi-ending-1366.png`, fullPage: true });
} finally {
  await Promise.allSettled(providerReads);
  await writeFile(`${output}/qa-report.json`, JSON.stringify({ capturedAt: new Date().toISOString(), issues, providerEvents }, null, 2));
  await browser.close();
}

if (issues.some((issue) => issue.type === "pageerror" || issue.type === "console:error" || issue.type === "models" || issue.type === "microphone")) {
  console.error(JSON.stringify(issues, null, 2));
  if (process.env.QA_START_SERVER === "1") process.exit(1);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, issues }, null, 2));
  if (process.env.QA_START_SERVER === "1") process.exit(0);
}

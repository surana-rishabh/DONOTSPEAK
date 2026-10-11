import { chromium } from "playwright-core";

process.env.PORT = "8492";
await import("../server/index.ts");

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-webgl"]
});

let failed = false;
try {
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/scribe-token", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"test realtime outage"}' }));
  let recordings = 0;
  await page.route("**/api/voice/transcribe", async (route) => {
    const body = route.request().postDataJSON();
    if (!body.base64 || !body.mimeType) throw new Error("Browser did not send recorded microphone audio");
    recordings += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"text":"Go to utility"}' });
  });
  await page.route("**/api/turns/resolve", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ source: "gemma", resolution: {
      version: "1.0", interpretation: "The caller crosses into utility.",
      action: { kind: "move", targetId: "caller" }, learnedConcepts: [],
      mutations: [{ kind: "move_actor", targetId: "caller", value: "utility" }],
      response: { speaker: "caller", text: "I reached the utility wing.", emotion: "afraid" },
      dangerDelta: 0, outcome: "continue"
    } })
  }));

  await page.goto("http://localhost:8492/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector(".transmission .section-title b")?.textContent === "MUTED", null, { timeout: 10_000 });

  const talk = page.getByRole("button", { name: /hold to speak/i });
  const box = await talk.boundingBox();
  if (!box) throw new Error("Push-to-talk button is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".transmission small")?.textContent?.includes("Go to utility"), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector(".sector-map .occupied")?.textContent === "UTILITY", null, { timeout: 10_000 });

  if (recordings !== 1 || errors.length) throw new Error(JSON.stringify({ recordings, errors }));
  console.log(JSON.stringify({ ok: true, microphone: "captured", fallback: "transcribed", command: "Go to utility", sector: "UTILITY" }));
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  process.exit(failed ? 1 : 0);
}

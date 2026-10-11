import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (message) => console.log(`BROWSER ${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => console.log(`BROWSER ERROR: ${error.message}`));
  await page.goto(process.env.BASE_URL || "http://localhost:5174/");
  const result = await page.evaluate(async () => {
    const { RoomRenderer } = await import("/src/render/RoomRenderer.ts");
    const canvas = document.createElement("canvas");
    const renderer = new RoomRenderer(canvas);
    let result = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      result = renderer.getAssetDiagnostics();
      if (result.length >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const roomNodes = renderer.getRoomNodeDiagnostics();
    renderer.dispose();
    return { result, roomNodes };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

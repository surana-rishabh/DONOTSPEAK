import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-webgl"] });
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 400 } });
  await page.goto(process.env.BASE_URL || "http://localhost:5174/");
  const frames = await page.evaluate(async () => {
    const { RoomRenderer } = await import("/src/render/RoomRenderer.ts");
    const canvas = document.createElement("canvas");
    document.body.replaceChildren(canvas);
    const renderer = new RoomRenderer(canvas);
    for (let attempt = 0; attempt < 80 && renderer.getAssetDiagnostics().length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    const arms = [];
    const nodeNames = [];
    renderer.caller.traverse((node) => { if (node.name) nodeNames.push(node.name); if (/Arm1/i.test(node.name)) arms.push(node); });
    const initial = arms.map((arm) => arm.quaternion.clone());
    const results = [];
    for (const axis of ["none", "x", "y", "z"]) {
      arms.forEach((arm, index) => {
        arm.quaternion.copy(initial[index]);
        if (axis !== "none") arm.rotation[axis] += (arm.name.includes("L_") ? 1 : -1) * 1.25;
      });
      renderer.renderer.render(renderer.scene, renderer.camera);
      results.push({ axis, data: canvas.toDataURL("image/png") });
    }
    renderer.dispose();
    return { results, names: arms.map((arm) => arm.name), nodeNames };
  });
  console.log(frames.names);
  console.log(frames.nodeNames);
  await mkdir("outputs/poses", { recursive: true });
  for (const frame of frames.results) await writeFile(`outputs/poses/${frame.axis}.png`, Buffer.from(frame.data.split(",")[1], "base64"));
} finally {
  await browser.close();
}

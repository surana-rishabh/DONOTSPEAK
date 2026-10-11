import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--enable-webgl"] });
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 400 } });
  await page.goto(process.env.BASE_URL || "http://localhost:5173/");
  const frames = await page.evaluate(async () => {
    const { RoomRenderer } = await import("/src/render/RoomRenderer.ts");
    const canvas = document.createElement("canvas");
    canvas.style.width = "100vw"; canvas.style.height = "100vh"; document.body.style.margin = "0";
    document.body.replaceChildren(canvas);
    const renderer = new RoomRenderer(canvas);
    for (let attempt = 0; attempt < 80 && renderer.getAssetDiagnostics().length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    if (renderer.getAssetDiagnostics().length < 2) throw new Error("Caller/mimic models did not load");
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
  const output = process.env.QA_OUTPUT_DIR || "outputs/poses";
  await mkdir(output, { recursive: true });
  for (const frame of frames.results) await writeFile(`${output}/${frame.axis}.png`, Buffer.from(frame.data.split(",")[1], "base64"));
} finally {
  await browser.close();
}

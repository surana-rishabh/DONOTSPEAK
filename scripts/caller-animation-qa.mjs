import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto("http://127.0.0.1:5173");
  assert.equal(await page.locator(".privacy-note, .health-row").count(), 0);
  assert.equal(await page.getByText("Incoming signal", { exact: true }).count(), 0);
  await page.evaluate(async () => {
    const { RoomRenderer } = await import("/src/render/RoomRenderer.ts");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:900px;height:700px";
    document.body.replaceChildren(canvas);
    window.animationQA = new RoomRenderer(canvas);
  });
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true", null, { timeout: 30000 });
  const idle = await page.evaluate(() => {
    const r = window.animationQA;
    r.setPaused(true);
    r.camera.position.set(2.8, 2.5, 4.5); r.controls.target.set(0, 0.9, 0.8); r.controls.update();
    const arms = [];
    r.caller.updateWorldMatrix(true, true);
    r.caller.traverse(node => {
      if (/Arm1/.test(node.name)) {
        const elbow = node.children.find(child => child.isBone);
        const shoulderPosition = node.getWorldPosition(node.position.clone());
        const elbowPosition = elbow.getWorldPosition(elbow.position.clone());
        arms.push(elbowPosition.y < shoulderPosition.y - 0.1);
      }
    });
    r.renderer.render(r.scene, r.camera);
    return { arms, y: r.caller.position.y, failures: r.canvas.dataset.modelFailures };
  });
  assert.deepEqual(idle.arms, [true, true]); assert.equal(idle.y, 0); assert.equal(idle.failures, "0");
  await page.screenshot({ path: "outputs/caller-idle.png" });
  const poses = [];
  for (let frame = 0; frame < 4; frame++) {
    poses.push(await page.evaluate(() => {
      const r = window.animationQA;
      for (let step = 0; step < 12; step++) r.callerAnimator.update(1 / 60, 1.48 / 60, false);
      r.renderer.render(r.scene, r.camera);
      const legs = [];
      r.caller.traverse(node => { if (/Leg1/.test(node.name)) legs.push(node.quaternion.toArray()); });
      return { legs, y: r.caller.position.y };
    }));
    await page.screenshot({ path: `outputs/caller-walk-${frame}.png` });
  }
  assert.notDeepEqual(poses[0].legs, poses[1].legs);
  assert.ok(poses.every(pose => pose.y === 0));
  await page.evaluate(() => {
    const r = window.animationQA;
    for (let step = 0; step < 90; step++) r.callerAnimator.update(1 / 60, 0, false);
    r.renderer.render(r.scene, r.camera);
  });
  await page.screenshot({ path: "outputs/caller-stopped.png" });
  const instant = await page.evaluate(() => {
    const r = window.animationQA;
    r.setPaused(false); r.startScare("caller");
    let head; r.caller.traverse(node => { if (!head && node.isBone && /head/i.test(node.name)) head = node; });
    const position = head.getWorldPosition(head.position.clone());
    position.y += 0.12;
    const distance = position.distanceTo(r.camera.position); position.project(r.camera);
    return { distance, x: position.x, y: position.y, controls: r.controls.enabled };
  });
  assert.ok(Math.abs(instant.distance - 0.42) < 0.01);
  assert.ok(Math.abs(instant.x) < 0.01 && Math.abs(instant.y) < 0.01);
  assert.equal(instant.controls, false);
  await page.screenshot({ path: "outputs/scare-instant-face.png" });
  await page.waitForFunction(() => !document.querySelector("canvas")?.dataset.scare);
  assert.equal(await page.evaluate(() => window.animationQA.controls.enabled), true);
  await page.evaluate(() => { window.animationQA.startScare("caller"); window.animationQA.setPaused(true); });
  assert.equal(await page.evaluate(() => window.animationQA.caller.position.y), 0);
  assert.equal(await page.locator("canvas").getAttribute("data-scare-distance"), null);
  await page.evaluate(() => window.animationQA.dispose());
  await page.route("**/api/health", route => route.fulfill({ json: { ok: true, gemma: false, elevenLabs: false } }));
  await page.route("**/api/voice/stream", route => route.fulfill({ status: 503, json: { error: "Caption-only animation test" } }));
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#codename").fill("NIGHTJAR");
  await page.getByRole("button", { name: /clock in/i }).click();
  await page.getByRole("button", { name: /answer call/i }).click();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.modelsReady === "true");
  assert.equal(await page.locator("canvas").getAttribute("data-webgl-error"), null);
  await page.locator("#command").fill("Go to B");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.walking === "true");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "outputs/caller-walk-game.png" });
  await page.waitForFunction(() => document.querySelector("canvas")?.dataset.walking === "false" && document.querySelector("canvas")?.dataset.callerX === "3.10", null, { timeout: 15000 });
  console.log(JSON.stringify({ ok: true, armsDown: true, articulatedLegs: true, rootHopping: false, removedText: true }));
} finally { await browser.close(); }

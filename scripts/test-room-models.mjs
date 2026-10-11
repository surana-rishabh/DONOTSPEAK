import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--enable-webgl", "--no-sandbox"]
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
  page.on("requestfailed", (req) => console.log("FAILED:", req.url(), req.failure()?.errorText));
  page.on("request", (req) => console.log("REQ:", req.url()));

  // Route local assets
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/models/")) {
      const filePath = path.resolve("public" + url.pathname);
      if (fs.existsSync(filePath)) {
        return route.fulfill({
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          contentType: url.pathname.endsWith(".json") ? "application/json" : "model/gltf-binary",
          body: fs.readFileSync(filePath)
        });
      }
    }
    if (url.pathname.startsWith("/draco/")) {
      const filePath = path.resolve("public" + url.pathname);
      if (fs.existsSync(filePath)) {
        return route.fulfill({
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          contentType: url.pathname.endsWith(".wasm") ? "application/wasm" : "application/javascript",
          body: fs.readFileSync(filePath)
        });
      }
    }
    if (url.pathname.startsWith("/three/")) {
      const relPath = url.pathname.replace(/^\/three\//, "");
      let filePath = path.resolve("node_modules/three/build", relPath);
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve("node_modules/three", relPath);
      }
      if (fs.existsSync(filePath)) {
        return route.fulfill({
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
          contentType: "application/javascript",
          body: fs.readFileSync(filePath)
        });
      }
    }
    route.continue();
  });

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <script type="importmap">
          {
            "imports": {
              "three": "http://local/three/three.module.js",
              "three/addons/": "http://local/three/examples/jsm/"
            }
          }
        </script>
      </head>
      <body style="margin: 0; background: #111;">
        <canvas id="c" width="1280" height="720"></canvas>
      </body>
    </html>
  `);

  const results = await page.evaluate(async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");

    const canvas = document.getElementById("c");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(1280, 720);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101819);
    const camera = new THREE.PerspectiveCamera(45, 1280 / 720, 0.1, 80);
    camera.position.set(8.2, 9, 11.5);
    camera.lookAt(0, 0.5, -0.3);

    scene.add(new THREE.HemisphereLight(0xc6e2e5, 0x31382b, 2.7));
    const dir = new THREE.DirectionalLight(0xffefdd, 2.8);
    dir.position.set(2, 9, 5);
    scene.add(dir);

    const draco = new DRACOLoader();
    draco.setDecoderPath("http://local/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const res = await fetch("http://local/models/assets.json");
    const manifest = await res.json();

    const loaded = [];
    for (const asset of manifest.models) {
      if (!asset.enabled) continue;
      try {
        const gltf = await loader.loadAsync("http://local" + asset.file);
        const obj = gltf.scene;
        obj.name = asset.id;
        
        const rawBox = new THREE.Box3().setFromObject(obj);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const rawCenter = rawBox.getCenter(new THREE.Vector3());

        // Normalization / positioning test
        let scale = asset.scale || 1;
        if (asset.role === "caller" || asset.role === "mimic") {
          scale = 1.75 / Math.max(rawSize.y, 0.01);
          obj.scale.setScalar(scale);
          const scaledBox = new THREE.Box3().setFromObject(obj);
          const scCenter = scaledBox.getCenter(new THREE.Vector3());
          obj.position.set(-scCenter.x, -scaledBox.min.y, -scCenter.z);
        } else {
          obj.scale.setScalar(scale);
          const scaledBox = new THREE.Box3().setFromObject(obj);
          const scCenter = scaledBox.getCenter(new THREE.Vector3());
          // Center and place base on floor
          obj.position.set(
            asset.position[0] - scCenter.x,
            asset.position[1] - scaledBox.min.y,
            asset.position[2] - scCenter.z
          );
        }

        if (asset.rotation) {
          obj.rotation.set(...asset.rotation);
        }

        scene.add(obj);
        const finalBox = new THREE.Box3().setFromObject(obj);
        loaded.push({
          id: asset.id,
          finalSize: finalBox.getSize(new THREE.Vector3()).toArray().map(v => Number(v.toFixed(2))),
          finalMin: finalBox.min.toArray().map(v => Number(v.toFixed(2))),
          finalMax: finalBox.max.toArray().map(v => Number(v.toFixed(2)))
        });
      } catch (err) {
        loaded.push({ id: asset.id, error: err.message });
      }
    }

    renderer.render(scene, camera);
    return loaded;
  });

  console.log(JSON.stringify(results, null, 2));

  // Save screenshot
  await page.screenshot({ path: "outputs/models-render-test.png" });
  console.log("Saved render test to outputs/models-render-test.png");
} finally {
  await browser.close();
}

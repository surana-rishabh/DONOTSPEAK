import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--enable-webgl", "--no-sandbox"]
});

try {
  const page = await browser.newPage();
  
  // Intercept requests and serve local files
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/models/")) {
      const filePath = path.resolve("public" + url.pathname);
      if (fs.existsSync(filePath)) {
        return route.fulfill({
          status: 200,
          contentType: "model/gltf-binary",
          body: fs.readFileSync(filePath)
        });
      }
    }
    if (url.pathname.startsWith("/draco/")) {
      const filePath = path.resolve("public" + url.pathname);
      if (fs.existsSync(filePath)) {
        return route.fulfill({
          status: 200,
          contentType: url.pathname.endsWith(".wasm") ? "application/wasm" : "application/javascript",
          body: fs.readFileSync(filePath)
        });
      }
    }
    route.continue();
  });

  // Load a minimal HTML with three.js
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <script type="importmap">
          {
            "imports": {
              "three": "https://unpkg.com/three@0.170.0/build/three.module.js",
              "three/addons/": "https://unpkg.com/three@0.170.0/examples/jsm/"
            }
          }
        </script>
      </head>
      <body>
        <canvas id="c"></canvas>
      </body>
    </html>
  `);

  const results = await page.evaluate(async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    
    const draco = new DRACOLoader();
    draco.setDecoderPath("http://local/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const manifest = [
      { id: "room_archive", file: "http://local/models/room_archive.glb" },
      { id: "caller", file: "http://local/models/caller_mara.glb" },
      { id: "mimic", file: "http://local/models/mimic_mara.glb" },
      { id: "red_door", file: "http://local/models/red_door.glb" },
      { id: "desk", file: "http://local/models/desk_terminal.glb" },
      { id: "locker", file: "http://local/models/locker_industrial.glb" },
      { id: "red_lamp", file: "http://local/models/red_lamp.glb" },
      { id: "mirror", file: "http://local/models/mirror_tall.glb" },
      { id: "radio", file: "http://local/models/radio_field.glb" },
      { id: "vent", file: "http://local/models/wall_vent.glb" },
      { id: "clock", file: "http://local/models/archive_clock.glb" }
    ];

    const out = [];
    for (const item of manifest) {
      try {
        const gltf = await loader.loadAsync(item.file);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        out.push({
          id: item.id,
          file: item.file,
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
          size: [size.x, size.y, size.z],
          center: [center.x, center.y, center.z]
        });
      } catch (e) {
        out.push({ id: item.id, error: e.message });
      }
    }
    return out;
  });

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

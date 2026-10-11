import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GameState } from "../game/engine";
import { STATIONS, STATION_POSITIONS } from "../../shared/rules";
import { buildSafeRoute, scareTransition, type ScareKind } from "./scenePolicy";
import { CallerAnimator } from "./CallerAnimator";

const CAMERAS = [
  { position: [8.2, 9, 11.5], target: [0, 0.5, -0.3] },
  { position: [-2.3, 4.7, 3.2], target: [-3.1, 0.9, -2.8] },
  { position: [0, 13.5, 0.3], target: [0, 0, -0.3] },
  { position: [0, 5, 7], target: [0, 0.8, 0.8] }
] as const;
type ModelAsset = {
  id: string;
  file: string;
  enabled: boolean;
  role: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
};
export class RoomRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 80);
  private controls: OrbitControls;
  private caller = new THREE.Group();
  private mimic = new THREE.Group();
  private door = new THREE.Group();
  private lamp = new THREE.PointLight(0xff3b32, 16, 8, 1.8);
  private keyLight = new THREE.SpotLight(0xdce9e8, 108, 24, Math.PI / 4.2, 0.58, 1.4);
  private cameraIndex = -1;
  private currentState: GameState | null = null;
  private path: THREE.Vector3[] = [];
  private target = new THREE.Vector3(...STATION_POSITIONS.center);
  private reducedMotion = false;
  private disposed = false;
  private paused = false;
  private raf = 0;
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;
  private draco = new DRACOLoader();
  private loadedAssets: THREE.Object3D[] = [];
  private callerAnimator: CallerAnimator | null = null;
  private overlay: HTMLElement | null;
  private anchors = new Map<string, HTMLElement>();
  private cameraGoal = new THREE.Vector3();
  private cameraTargetGoal = new THREE.Vector3();
  private cameraBlend = 1;
  private difference = new THREE.Vector3();
  private followGoal = new THREE.Vector3();
  private mimicGoal = new THREE.Vector3();
  private scare: { kind: ScareKind; started: number; actorStart: THREE.Vector3; cameraStart: THREE.Vector3 } | null = null;
  public onTravelChange?: (moving: boolean) => void;
  public onScareChange?: (kind: ScareKind | null) => void;
  private projected = new THREE.Vector3();
  private onKey = (event: KeyboardEvent) => {
    if (event.target !== this.canvas) return;
    const key = event.key.toLowerCase();
    const offset = new THREE.Vector3(key === "arrowleft" || key === "a" ? -0.45 : key === "arrowright" || key === "d" ? 0.45 : 0, 0,
      key === "arrowup" || key === "w" ? -0.45 : key === "arrowdown" || key === "s" ? 0.45 : 0);
    if (offset.lengthSq()) { event.preventDefault(); this.camera.position.add(offset); this.controls.target.add(offset); }
  };
  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.1 : 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x060b0d); this.scene.fog = new THREE.FogExp2(0x071013, 0.024);
    this.scene.add(new THREE.HemisphereLight(0x9ab6ba, 0x17201d, 1.08));
    this.keyLight.position.set(-2.8, 7.5, 4.5); this.keyLight.target.position.set(0, 0.4, -0.7);
    this.keyLight.castShadow = true; this.keyLight.shadow.mapSize.set(innerWidth < 700 ? 512 : 1024, innerWidth < 700 ? 512 : 1024);
    this.keyLight.shadow.camera.near = 1; this.keyLight.shadow.camera.far = 24; this.keyLight.shadow.bias = -0.0004;
    this.scene.add(this.keyLight, this.keyLight.target);
    const blue = new THREE.PointLight(0x79c9d5, 26, 13, 2); blue.position.set(-2.2, 3.1, 1.8); this.scene.add(blue);
    this.lamp.position.set(2.7, 2.4, 0.2); this.scene.add(this.lamp);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4; this.controls.maxDistance = 23;
    this.controls.minPolarAngle = 0.04; this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.enablePan = true;
    this.overlay = canvas.parentElement?.querySelector(".world-anchors") || null;
    this.overlay?.querySelectorAll<HTMLElement>("[data-anchor]").forEach((node) => this.anchors.set(node.dataset.anchor || "", node));
    this.buildRoom();
    this.makeActor(this.caller, 0xc5d3d1); this.caller.position.copy(this.target); this.scene.add(this.caller);
    this.makeActor(this.mimic, 0x73414b); this.mimic.position.set(2.4, 0, -1.8); this.mimic.visible = false; this.scene.add(this.mimic);
    this.setCamera(0);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
      this.camera.aspect = rect.width / rect.height; this.camera.updateProjectionMatrix();
    };
    this.resizeObserver = new ResizeObserver(resize); this.resizeObserver.observe(canvas); resize();
    canvas.addEventListener("keydown", this.onKey);
    void this.loadModels(); this.loop();
  }
  private box(name: string, size: [number, number, number], pos: [number, number, number], color: number, parent: THREE.Object3D = this.scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: name.includes("floor") || name.includes("beam") ? 0.28 : 0.12 }));
    mesh.castShadow = !name.includes("floor") && !name.includes("wall"); mesh.receiveShadow = true;
    mesh.name = name; mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  private buildRoom() {
    this.box("floor_slab", [10, 0.22, 8], [0, -0.11, 0], 0x202a2d);
    for (const x of [-3.75, -1.25, 1.25, 3.75]) for (const z of [-3, -1, 1, 3]) {
      const panel = this.box("floor_panel", [2.42, 0.025, 1.92], [x, 0.015, z], (Math.abs(x + z) % 2 ? 0x334044 : 0x2c383c)); panel.receiveShadow = true;
    }
    this.box("back_wall", [10, 3.5, 0.2], [0, 1.75, -4], 0x263437);
    this.box("left_wall", [0.2, 3.5, 8], [-5, 1.75, 0], 0x1e2b2f);
    this.box("right_wall", [0.2, 3.5, 8], [5, 1.75, 0], 0x1e2b2f);
    for (const x of [-4, -2, 0, 2, 4]) this.box("wall_rib", [0.09, 3.3, 0.24], [x, 1.65, -3.86], 0x526065);
    for (const x of [-4.72, 4.72]) this.box("ceiling_beam", [0.16, 0.14, 7.7], [x, 3.28, 0], 0x414e52);
    this.box("ceiling_beam", [9.6, 0.14, 0.16], [0, 3.28, -3.72], 0x414e52);
    const conduitMaterial = new THREE.MeshStandardMaterial({ color: 0x5f6d69, roughness: 0.5, metalness: 0.65 });
    for (const y of [2.65, 2.9]) {
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 8.5, 10), conduitMaterial); conduit.rotation.z = Math.PI / 2; conduit.position.set(0.3, y, -3.72); conduit.castShadow = true; this.scene.add(conduit);
    }
    const fixture = this.box("ceiling_fixture", [2.5, 0.08, 0.28], [-1.3, 3.14, 0.9], 0xb8d4d2);
    (fixture.material as THREE.MeshStandardMaterial).emissive.set(0x6d9b9d); (fixture.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8;
    this.door.position.set(-4.25, 0, -3.83);
    this.box("red_door", [1.4, 2.35, 0.16], [0.7, 1.175, 0], 0xa5514c, this.door); this.scene.add(this.door);
    this.box("desk", [2.35, 0.14, 1], [0, 1, -0.7], 0x8e7c63);
    for (const x of [-0.9, 0.9]) this.box("desk_leg", [0.1, 1, 0.65], [x, 0.5, -0.7], 0x4c5555);
    this.box("radio", [0.6, 0.28, 0.3], [0.4, 1.2, -0.7], 0x262e31);
    this.box("locker", [0.9, 2.1, 0.65], [4, 1.05, -3.3], 0x687f7e);
    this.box("generator", [1.1, 1, 0.7], [3.1, 0.5, -2.35], 0x517e78);
    this.box("generator_screen", [0.5, 0.26, 0.04], [3.1, 0.8, -1.98], 0x9ddcbd);
    this.box("signal_console", [1.1, 0.75, 0.65], [3.2, 0.375, 2.35], 0x556c89);
    this.box("signal_screen", [0.7, 0.4, 0.1], [3.2, 0.95, 2.35], 0x8dafcd);
    this.box("mirror", [0.06, 1.6, 1.2], [4.7, 1.2, -1.8], 0x99bbc3);
    this.box("vent", [1, 0.5, 0.1], [-1.6, 0.5, -3.85], 0x81918b);
    const lamp = this.box("lamp", [0.2, 0.2, 0.2], [2.7, 2.4, 0.2], 0xff8176);
    (lamp.material as THREE.MeshStandardMaterial).emissive.set(0xff2018); (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2;
    this.box("holding_pad", [1.5, 0.05, 1.4], [-3.1, 0.025, 2.5], 0x75684f);
    for (const station of STATIONS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 40), new THREE.MeshBasicMaterial({ color: station.code === "A" ? 0xe89f86 : station.code === "B" ? 0xbdd798 : 0x98cbd8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(station.position[0], 0.04, station.position[2]); this.scene.add(ring);
    }
  }
  private makeActor(group: THREE.Group, color: number) {
    const material = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.75, 4, 8), material); body.position.y = 0.8; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), material); head.position.y = 1.55; head.castShadow = true; group.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.31, 24), new THREE.MeshBasicMaterial({ color: 0xffe1a7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = "actor-ring"; group.add(ring);
  }
  private async loadModels() {
    try {
      const response = await fetch("/models/assets.json");
      if (this.disposed) return;
      if (!response.ok) throw new Error("Model manifest unavailable");
      const manifest = await response.json() as { models: ModelAsset[] };
      const loader = new GLTFLoader();
      this.draco.setDecoderPath("/draco/");
      loader.setDRACOLoader(this.draco);

      let failures = 0;
      const assets = manifest.models.filter((asset) => asset.enabled);
      const loadAsset = async (asset: ModelAsset) => {
        try {
          const gltf = await loader.loadAsync(asset.file);
          const object = gltf.scene;
          if (this.disposed) { this.disposeObject(object); return; }

          if (asset.role === "caller" || asset.role === "mimic") {
            const bounds = new THREE.Box3().setFromObject(object);
            const size = bounds.getSize(new THREE.Vector3());
            object.scale.setScalar(1.75 / Math.max(size.y, 0.01));
            const scaled = new THREE.Box3().setFromObject(object);
            const center = scaled.getCenter(new THREE.Vector3());
            object.position.set(-center.x, -scaled.min.y, -center.z);
            object.name = `asset:${asset.id}`;
            object.userData.baseY = object.position.y;

            if (asset.role === "mimic") {
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  const materials = Array.isArray(child.material) ? child.material : [child.material];
                  child.material = materials.map((m) => {
                    const copy = m.clone();
                    if (copy instanceof THREE.MeshStandardMaterial) {
                      copy.color.multiplyScalar(0.35);
                      copy.emissive.set(0x240710);
                    }
                    return copy;
                  });
                }
              });
            }
            const actor = asset.role === "caller" ? this.caller : this.mimic;
            for (const child of [...actor.children]) {
              if (child.name !== "actor-ring") { actor.remove(child); this.disposeObject(child); }
            }
            actor.add(object);
            const animator = new CallerAnimator(actor, object);
            if (asset.role === "caller") this.callerAnimator = animator;
            this.loadedAssets.push(object);
          } else if (asset.id === "red_door") {
            const scale = asset.scale || 1.18;
            object.scale.setScalar(scale);
            const scaled = new THREE.Box3().setFromObject(object);
            const center = scaled.getCenter(new THREE.Vector3());
            object.position.set(0.7 - center.x, -scaled.min.y, -center.z);
            object.name = `asset:${asset.id}`;

            const oldDoor = this.door.getObjectByName("red_door");
            if (oldDoor) { this.door.remove(oldDoor); this.disposeObject(oldDoor); }
            this.door.add(object);
            this.loadedAssets.push(object);
          } else if (asset.role === "prop") {
            const scale = asset.scale || 1;
            object.scale.setScalar(scale);
            const scaled = new THREE.Box3().setFromObject(object);
            const center = scaled.getCenter(new THREE.Vector3());
            const pos = asset.position || [0, 0, 0];
            object.position.set(pos[0] - center.x, pos[1] - scaled.min.y, pos[2] - center.z);
            if (asset.rotation) {
              object.rotation.set(...asset.rotation);
            }
            object.name = `asset:${asset.id}`;

            const targetName = asset.id === "red_lamp" ? "lamp" : asset.id;
            const oldMesh = this.scene.getObjectByName(targetName);
            if (oldMesh) { this.scene.remove(oldMesh); this.disposeObject(oldMesh); }
            if (asset.id === "desk") {
              const legs = this.scene.children.filter((c) => c.name === "desk_leg");
              for (const leg of legs) { this.scene.remove(leg); this.disposeObject(leg); }
            }

            this.scene.add(object);
            this.loadedAssets.push(object);
          }
          object.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
        } catch (assetErr) {
          failures += 1;
          console.warn(`Could not load model asset ${asset.id} (${asset.file}):`, assetErr);
        }
      };
      for (let index = 0; index < assets.length && !this.disposed; index += 3) await Promise.all(assets.slice(index, index + 3).map(loadAsset));
      if (this.disposed) return;
      this.canvas.dataset.modelCount = String(this.loadedAssets.length);
      this.canvas.dataset.modelFailures = String(failures);
      this.canvas.dataset.modelsReady = "true";
    } catch (error) {
      if (!this.disposed) this.canvas.dataset.modelsError = error instanceof Error ? error.message : "Model loading failed";
    }
  }
  setReducedMotion(value: boolean) { this.reducedMotion = value; this.controls.enableDamping = !value; }
  setPaused(value: boolean) {
    if (value === this.paused) return;
    this.paused = value;
    if (value) {
      cancelAnimationFrame(this.raf); this.path = []; this.onTravelChange?.(false);
      this.scare = null; delete this.canvas.dataset.scare; this.onScareChange?.(null);
    }
    else { this.lastTime = performance.now(); this.loop(); }
  }
  setCamera(index: number) {
    const initial = this.cameraIndex < 0;
    this.cameraIndex = Math.max(0, Math.min(3, index));
    const pose = CAMERAS[this.cameraIndex];
    this.cameraGoal.set(pose.position[0], pose.position[1], pose.position[2]); this.cameraTargetGoal.set(pose.target[0], pose.target[1], pose.target[2]);
    if (initial || this.reducedMotion) { this.camera.position.copy(this.cameraGoal); this.controls.target.copy(this.cameraTargetGoal); this.cameraBlend = 1; }
    else this.cameraBlend = 0;
    this.controls.update();
  }
  resetCamera() { this.setCamera(this.cameraIndex); }
  update(state: GameState) {
    const newCall = state.callId !== this.currentState?.callId;
    const newPosition = state.callerPosition !== this.currentState?.callerPosition;
    if (newCall) {
      this.caller.position.set(...STATION_POSITIONS[state.callerPosition]); this.target.copy(this.caller.position); this.path = []; this.onTravelChange?.(false);
    }
    if (newPosition && !newCall && this.paused) {
      this.caller.position.set(...STATION_POSITIONS[state.callerPosition]); this.target.copy(this.caller.position); this.path = []; this.onTravelChange?.(false);
    } else if (newPosition && !newCall) {
      this.target.set(...STATION_POSITIONS[state.callerPosition]);
      this.path = buildSafeRoute([this.caller.position.x, 0, this.caller.position.z], STATION_POSITIONS[state.callerPosition]).map((point) => new THREE.Vector3(...point));
      this.onTravelChange?.(true);
    }
    const scare = this.paused ? null : scareTransition(this.currentState, state, this.reducedMotion);
    if (scare) this.startScare(scare);
    if (state.cameraIndex !== this.cameraIndex || newCall) this.setCamera(state.cameraIndex);
    this.currentState = state;
    this.mimic.visible = state.mimicVisible;
    this.lamp.visible = state.powerOn;
    this.door.rotation.y = state.doorsOpen ? -Math.PI / 2 : 0;
  }
  private startScare(kind: ScareKind) {
    const actor = kind === "mimic" ? this.mimic : this.caller;
    this.scare = { kind, started: performance.now(), actorStart: actor.position.clone(), cameraStart: this.camera.position.clone() };
    this.onScareChange?.(kind); this.canvas.dataset.scare = kind;
  }
  private loop = () => {
    if (this.disposed || this.paused) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - this.lastTime) / 1000); this.lastTime = now;
    const previousX = this.caller.position.x; const previousZ = this.caller.position.z;
    const destination = this.path[0];
    if (destination) {
      const difference = this.difference.copy(destination).sub(this.caller.position); difference.y = 0;
      const distance = difference.length(); const step = dt * 1.48;
      if (this.reducedMotion || distance <= step) {
        this.caller.position.copy(destination); this.path.shift();
        if (!this.path.length) this.onTravelChange?.(false);
      } else { this.caller.position.addScaledVector(difference.normalize(), step); this.caller.rotation.y = Math.atan2(difference.x, difference.z); }
    }
    this.caller.position.y = 0;
    this.caller.rotation.z = 0;
    this.callerAnimator?.update(dt, Math.hypot(this.caller.position.x - previousX, this.caller.position.z - previousZ), this.reducedMotion);
    if (this.currentState?.mimicVisible) {
      const position = this.currentState.mimicPosition === "stairwell" ? STATION_POSITIONS.stairwell : [2.4, 0, -1.8] as const;
      this.mimicGoal.set(position[0] + 0.6, 0, position[2]);
      if (!this.scare || this.scare.kind !== "mimic") this.mimic.position.lerp(this.mimicGoal, this.reducedMotion ? 1 : 1 - Math.exp(-dt * 0.9));
    }
    if (this.cameraIndex === 3 && this.path.length) {
      this.followGoal.set(this.caller.position.x, this.caller.position.y + 5, this.caller.position.z + 7);
      this.camera.position.lerp(this.followGoal, 1 - Math.exp(-dt * 1.3));
      this.followGoal.set(this.caller.position.x, this.caller.position.y + 0.8, this.caller.position.z);
      this.controls.target.lerp(this.followGoal, 1 - Math.exp(-dt * 1.3));
    }
    if (this.cameraBlend < 1 && !this.scare) {
      this.cameraBlend = Math.min(1, this.cameraBlend + dt * 2.8);
      this.camera.position.lerp(this.cameraGoal, 1 - Math.exp(-dt * 8)); this.controls.target.lerp(this.cameraTargetGoal, 1 - Math.exp(-dt * 8));
    }
    if (this.scare) {
      const duration = this.scare.kind === "mimic" ? 920 : 1050; const progress = Math.min(1, (now - this.scare.started) / duration);
      const actor = this.scare.kind === "mimic" ? this.mimic : this.caller;
      const forward = this.camera.getWorldDirection(this.followGoal);
      const nearCamera = this.followGoal.multiplyScalar(1.15).add(this.camera.position); nearCamera.y -= 0.9;
      const amount = this.scare.kind === "mimic" ? Math.sin(Math.PI * progress) : 1 - Math.pow(1 - progress, 3);
      actor.position.lerpVectors(this.scare.actorStart, nearCamera, amount);
      if (!this.reducedMotion) {
        const shake = (1 - progress) * (this.scare.kind === "mimic" ? 0.06 : 0.035);
        this.camera.position.x = this.scare.cameraStart.x + Math.sin(now * 0.055) * shake;
        this.camera.position.y = this.scare.cameraStart.y + Math.cos(now * 0.071) * shake;
      }
      if (progress >= 1) {
        if (this.scare.kind === "mimic") actor.position.copy(this.scare.actorStart);
        this.scare = null; delete this.canvas.dataset.scare; this.onScareChange?.(null);
      }
    }
    const danger = this.currentState?.danger || 0;
    this.lamp.intensity = this.currentState?.powerOn ? 12 + danger * 0.7 + Math.sin(now * 0.018) * (danger > 5 ? 2.2 : 0.35) : 0;
    this.controls.update();
    for (const station of STATIONS) {
      const node = this.anchors.get(station.code); if (!node) continue;
      this.projected.set(station.position[0], 0.35, station.position[2]).project(this.camera);
      const x = (this.projected.x * 0.5 + 0.5) * 100; const y = (-this.projected.y * 0.5 + 0.5) * 100;
      node.style.left = `${x}%`; node.style.top = `${y}%`;
      node.hidden = this.projected.z > 1 || x < 3 || x > 97 || y < 6 || y > 88;
    }
    this.canvas.dataset.walking = String(Boolean(this.path.length));
    this.canvas.dataset.callerX = this.caller.position.x.toFixed(2); this.canvas.dataset.callerZ = this.caller.position.z.toFixed(2);
    this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(this.loop);
  };
  captureFrame() {
    this.renderer.render(this.scene, this.camera);
    const target = document.createElement("canvas"); target.width = 512; target.height = Math.round(512 / this.camera.aspect);
    target.getContext("2d")?.drawImage(this.canvas, 0, 0, target.width, target.height); return target.toDataURL("image/jpeg", 0.65);
  }
  getAssetDiagnostics() { return this.loadedAssets.map((object) => ({ name: object.name, size: new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).toArray() })); }
  getRoomNodeDiagnostics() { return this.scene.children.filter((child) => /wall|floor|beam|fixture/.test(child.name)).map((child) => child.name); }
  private disposeObject(object: THREE.Object3D) {
    object.traverse((child) => { if (child instanceof THREE.Mesh) {
      child.geometry.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); }
    } });
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.resizeObserver.disconnect();
    this.path = []; this.scare = null; this.onTravelChange?.(false); this.onScareChange?.(null);
    // React StrictMode reuses this canvas immediately; losing its context breaks the next renderer.
    this.canvas.removeEventListener("keydown", this.onKey); this.controls.dispose(); this.disposeObject(this.scene); this.draco.dispose(); this.renderer.dispose();
  }
}

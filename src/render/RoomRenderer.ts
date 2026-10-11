import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GameState } from "../game/engine";
import { STATIONS, STATION_POSITIONS } from "../../shared/rules";

const CAMERAS = [
  { position: [8.2, 9, 11.5], target: [0, 0.5, -0.3] },
  { position: [-2.3, 4.7, 3.2], target: [-3.1, 0.9, -2.8] },
  { position: [0, 13.5, 0.3], target: [0, 0, -0.3] },
  { position: [0, 5, 7], target: [0, 0.8, 0.8] }
] as const;
type ModelAsset = { id: string; file: string; enabled: boolean; role: string; scale?: number };
export class RoomRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 80);
  private controls: OrbitControls;
  private caller = new THREE.Group();
  private mimic = new THREE.Group();
  private door = new THREE.Group();
  private lamp = new THREE.PointLight(0xff5848, 8, 8);
  private cameraIndex = -1;
  private currentState: GameState | null = null;
  private path: THREE.Vector3[] = [];
  private target = new THREE.Vector3(...STATION_POSITIONS.center);
  private reducedMotion = false;
  private disposed = false;
  private raf = 0;
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;
  private draco = new DRACOLoader();
  private loadedAssets: THREE.Object3D[] = [];
  private overlay: HTMLElement | null;
  public onTravelChange?: (moving: boolean) => void;
  private projected = new THREE.Vector3();
  private onKey = (event: KeyboardEvent) => {
    if (event.target !== this.canvas) return;
    const key = event.key.toLowerCase();
    const offset = new THREE.Vector3(key === "arrowleft" || key === "a" ? -0.45 : key === "arrowright" || key === "d" ? 0.45 : 0, 0,
      key === "arrowup" || key === "w" ? -0.45 : key === "arrowdown" || key === "s" ? 0.45 : 0);
    if (offset.lengthSq()) { event.preventDefault(); this.camera.position.add(offset); this.controls.target.add(offset); }
  };
  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x101819);
    this.scene.add(new THREE.HemisphereLight(0xc6e2e5, 0x31382b, 2.7));
    const key = new THREE.DirectionalLight(0xffefdd, 2.8); key.position.set(2, 9, 5); this.scene.add(key);
    const blue = new THREE.PointLight(0x87ced8, 18, 14); blue.position.set(-2, 5, 2); this.scene.add(blue);
    this.lamp.position.set(2.7, 2.4, 0.2); this.scene.add(this.lamp);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4; this.controls.maxDistance = 23;
    this.controls.minPolarAngle = 0.04; this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.enablePan = true;
    this.overlay = canvas.parentElement?.querySelector(".world-anchors") || null;
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.82 }));
    mesh.name = name; mesh.position.set(...pos); parent.add(mesh); return mesh;
  }
  private buildRoom() {
    this.box("floor", [10, 0.2, 8], [0, -0.1, 0], 0x2c393a);
    // Low perimeter walls keep every surveillance angle readable.
    this.box("back_wall", [10, 1.2, 0.18], [0, 0.6, -4], 0x44575a);
    this.box("left_wall", [0.18, 0.75, 8], [-5, 0.375, 0], 0x34484c);
    this.box("right_wall", [0.18, 0.75, 8], [5, 0.375, 0], 0x34484c);
    const grid = new THREE.GridHelper(10, 20, 0x47656b, 0x35464a); grid.position.y = 0.01; this.scene.add(grid);
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
    this.box("lamp", [0.2, 0.2, 0.2], [2.7, 2.4, 0.2], 0xff8176);
    this.box("holding_pad", [1.5, 0.05, 1.4], [-3.1, 0.025, 2.5], 0x75684f);
    for (const station of STATIONS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 40), new THREE.MeshBasicMaterial({ color: station.code === "A" ? 0xe89f86 : station.code === "B" ? 0xbdd798 : 0x98cbd8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(station.position[0], 0.04, station.position[2]); this.scene.add(ring);
    }
  }
  private makeActor(group: THREE.Group, color: number) {
    const material = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.75, 4, 8), material); body.position.y = 0.8; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), material); head.position.y = 1.55; group.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.31, 24), new THREE.MeshBasicMaterial({ color: 0xffe1a7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = "actor-ring"; group.add(ring);
  }
  private async loadModels() {
    try {
      const response = await fetch("/models/assets.json"); if (!response.ok) throw new Error("Model manifest unavailable");
      const manifest = await response.json() as { models: ModelAsset[] };
      const loader = new GLTFLoader(); this.draco.setDecoderPath("/draco/"); loader.setDRACOLoader(this.draco);
      for (const asset of manifest.models.filter((a) => a.enabled && ["caller", "mimic"].includes(a.role))) {
        const gltf = await loader.loadAsync(asset.file); const object = gltf.scene;
        if (this.disposed) { this.disposeObject(object); return; }
        object.traverse((child) => { if (/^Arm1[LR]_/.test(child.name)) child.rotation.y += (child.name.includes("L_") ? 1 : -1) * 1.25; });
        const bounds = new THREE.Box3().setFromObject(object); const size = bounds.getSize(new THREE.Vector3());
        object.scale.setScalar(1.75 / Math.max(size.y, 0.01));
        const scaled = new THREE.Box3().setFromObject(object); const center = scaled.getCenter(new THREE.Vector3());
        object.position.set(-center.x, -scaled.min.y, -center.z); object.name = `asset:${asset.id}`;
        if (asset.role === "mimic") object.traverse((child) => { if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          child.material = materials.map((m) => { const copy = m.clone(); if (copy instanceof THREE.MeshStandardMaterial) { copy.color.multiplyScalar(0.35); copy.emissive.set(0x240710); } return copy; });
        } });
        const actor = asset.role === "caller" ? this.caller : this.mimic;
        for (const child of [...actor.children]) if (child.name !== "actor-ring") { actor.remove(child); this.disposeObject(child); }
        actor.add(object); this.loadedAssets.push(object);
      }
      this.canvas.dataset.modelsReady = "true";
    } catch (error) { if (!this.disposed) this.canvas.dataset.modelsError = error instanceof Error ? error.message : "Model loading failed"; }
  }
  setReducedMotion(value: boolean) { this.reducedMotion = value; this.controls.enableDamping = !value; }
  setCamera(index: number) {
    this.cameraIndex = Math.max(0, Math.min(3, index));
    const pose = CAMERAS[this.cameraIndex]; this.camera.position.set(...pose.position); this.controls.target.set(...pose.target); this.controls.update();
  }
  resetCamera() { this.setCamera(this.cameraIndex); }
  update(state: GameState) {
    const newCall = state.callId !== this.currentState?.callId;
    const newPosition = state.callerPosition !== this.currentState?.callerPosition;
    if (newCall) {
      this.caller.position.set(...STATION_POSITIONS.center); this.target.copy(this.caller.position); this.path = []; this.onTravelChange?.(false);
    }
    if (newPosition && !newCall) {
      this.target.set(...STATION_POSITIONS[state.callerPosition]);
      this.path = [new THREE.Vector3(this.caller.position.x, 0, 0.8), new THREE.Vector3(this.target.x, 0, 0.8), this.target.clone()];
      this.onTravelChange?.(true);
    }
    if (state.cameraIndex !== this.cameraIndex || newCall) this.setCamera(state.cameraIndex);
    this.currentState = state;
    this.mimic.visible = state.mimicVisible;
    this.lamp.visible = state.powerOn;
    this.door.rotation.y = state.doorsOpen ? -Math.PI / 2 : 0;
  }
  private loop = () => {
    if (this.disposed) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - this.lastTime) / 1000); this.lastTime = now;
    const destination = this.path[0];
    if (destination) {
      const difference = destination.clone().sub(this.caller.position); difference.y = 0;
      const distance = difference.length(); const step = dt * 1.6;
      if (this.reducedMotion || distance <= step) {
        this.caller.position.copy(destination); this.path.shift();
        if (!this.path.length) this.onTravelChange?.(false);
      } else { this.caller.position.addScaledVector(difference.normalize(), step); this.caller.rotation.y = Math.atan2(difference.x, difference.z); }
    }
    if (this.currentState?.mimicVisible) {
      const position = this.currentState.mimicPosition === "stairwell" ? STATION_POSITIONS.stairwell : [2.4, 0, -1.8] as const;
      this.mimic.position.lerp(new THREE.Vector3(position[0] + 0.6, 0, position[2]), this.reducedMotion ? 1 : 1 - Math.exp(-dt * 0.9));
    }
    if (this.cameraIndex === 3 && this.path.length) {
      const offset = this.caller.position.clone().add(new THREE.Vector3(0, 5, 7));
      this.camera.position.lerp(offset, 1 - Math.exp(-dt * 1.3));
      this.controls.target.lerp(this.caller.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 1 - Math.exp(-dt * 1.3));
    }
    this.controls.update();
    for (const station of STATIONS) {
      const node = this.overlay?.querySelector<HTMLElement>(`[data-anchor="${station.code}"]`); if (!node) continue;
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
  getRoomNodeDiagnostics() { return []; }
  private disposeObject(object: THREE.Object3D) {
    object.traverse((child) => { if (child instanceof THREE.Mesh) {
      child.geometry.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); }
    } });
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.resizeObserver.disconnect();
    this.canvas.removeEventListener("keydown", this.onKey); this.controls.dispose(); this.disposeObject(this.scene); this.draco.dispose(); this.renderer.dispose();
  }
}

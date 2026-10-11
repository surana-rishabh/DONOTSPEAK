import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { GameState } from "../game/engine";

type TaggedObject = THREE.Object3D & { userData: { entityId?: string; procedural?: boolean } };
type ModelAsset = {
  id: string;
  file: string;
  enabled: boolean;
  role: "room" | "caller" | "mimic" | "prop";
  scale?: number | [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
};

const CAMERA_POSES = [
  { position: new THREE.Vector3(0, 2.45, 3.55), target: new THREE.Vector3(0, 1.05, -0.6) }, // 0: ARCHIVE
  { position: new THREE.Vector3(4.2, 2.35, 1.4), target: new THREE.Vector3(-1.1, 1.0, -1.5) }, // 1: THRESHOLD
  { position: new THREE.Vector3(5.4, 6.2, -0.1), target: new THREE.Vector3(3.1, 0.4, -2.4) }, // 2: OVERHEAD
  { position: new THREE.Vector3(0, 3.1, 4.0), target: new THREE.Vector3(0, 1.0, 0) }, // 3: TRACK (FOLLOW CAM)
  { position: new THREE.Vector3(3.5, 2.5, 4.5), target: new THREE.Vector3(3.5, 1.0, 2.1) },
  { position: new THREE.Vector3(-3.1, 2.6, 4.5), target: new THREE.Vector3(-3.1, 1.0, 2.2) }
];

const POSITIONS: Record<GameState["callerPosition"], THREE.Vector3> = {
  center: new THREE.Vector3(0, 0, 0.8),
  door: new THREE.Vector3(-3.2, 0, -1.3),
  lamp: new THREE.Vector3(2.8, 0, 0.3),
  mirror: new THREE.Vector3(2.6, 0, -2.8),
  vent: new THREE.Vector3(-2.2, 0, -3.2),
  exit: new THREE.Vector3(-4, 0, -1.6),
  archive: new THREE.Vector3(0, 0, 0),
  threshold: new THREE.Vector3(-4.1, 0, -1.5),
  utility: new THREE.Vector3(3.1, 0, -2.4),
  observation: new THREE.Vector3(3.6, 0, 2.3),
  stairwell: new THREE.Vector3(-3.1, 0, 2.5)
};

const WORLD_BOUNDS = { minX: -4.8, maxX: 4.8, minZ: -4.8, maxZ: 3.7 };

const OBSTACLES: Array<{
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  blocksIf?: (state: GameState | null) => boolean;
}> = [
  // Central workstation desk & chair
  { id: "desk", minX: -1.2, maxX: 1.6, minZ: -1.3, maxZ: 0.0 },
  // Heavy evidence locker
  { id: "locker", minX: 3.2, maxX: 4.4, minZ: -3.8, maxZ: -2.8 },
  // Red door on north wall (blocks doorway threshold when closed)
  { id: "red_door", minX: -4.4, maxX: -2.7, minZ: -4.1, maxZ: -3.6, blocksIf: (s) => !s?.doorsOpen },
  // North solid wall left of door
  { id: "wall_north_left", minX: -5.2, maxX: -4.4, minZ: -4.2, maxZ: -3.7 },
  // North solid wall right of door
  { id: "wall_north_right", minX: -2.7, maxX: 5.2, minZ: -4.2, maxZ: -3.7 },
  // Utility generator & breaker
  { id: "utility_generator", minX: 2.5, maxX: 3.7, minZ: -2.9, maxZ: -1.9 },
  // Observation console
  { id: "observation_console", minX: 3.0, maxX: 4.3, minZ: 1.7, maxZ: 2.8 },
  // Wall shelves
  { id: "shelf_w", minX: -4.8, maxX: -4.1, minZ: -2.8, maxZ: -0.5 },
  { id: "shelf_e", minX: 4.1, maxX: 4.8, minZ: -2.8, maxZ: -0.5 }
];

function isInsideAnyObstacle(x: number, z: number, state: GameState | null, radius = 0.28): boolean {
  if (x < WORLD_BOUNDS.minX + radius || x > WORLD_BOUNDS.maxX - radius) return true;
  if (z < WORLD_BOUNDS.minZ + radius || z > WORLD_BOUNDS.maxZ - radius) return true;

  for (const obs of OBSTACLES) {
    if (obs.blocksIf && !obs.blocksIf(state)) continue;
    if (
      x > obs.minX - radius &&
      x < obs.maxX + radius &&
      z > obs.minZ - radius &&
      z < obs.maxZ + radius
    ) {
      return true;
    }
  }
  return false;
}

function resolveCollision(
  currX: number,
  currZ: number,
  destX: number,
  destZ: number,
  state: GameState | null,
  radius = 0.28
): [number, number] {
  // If unobstructed, move directly
  if (!isInsideAnyObstacle(destX, destZ, state, radius)) {
    return [destX, destZ];
  }

  // Slide along X (cancel Z penetration)
  let nx = currX;
  if (!isInsideAnyObstacle(destX, currZ, state, radius)) {
    nx = destX;
  }

  // Slide along Z (cancel X penetration)
  let nz = currZ;
  if (!isInsideAnyObstacle(nx, destZ, state, radius)) {
    nz = destZ;
  } else if (!isInsideAnyObstacle(currX, destZ, state, radius)) {
    nz = destZ;
  }

  // Escape hatch if already inside an obstacle
  if (nx === currX && nz === currZ && isInsideAnyObstacle(currX, currZ, state, radius)) {
    return [destX, destZ];
  }

  return [nx, nz];
}

const SECTOR_COORDS: Record<string, [number, number]> = {
  center: [0, 0.8],
  archive: [0, 0],
  threshold: [-4.1, -1.5],
  door: [-3.55, -3.83],
  lamp: [2.7, 0.2],
  mirror: [4.2, -1.8],
  vent: [-1.6, -3.5],
  utility: [3.1, -2.4],
  observation: [3.6, 2.3],
  stairwell: [-3.1, 2.5],
  exit: [-4.0, -1.6]
};

function findNearestSector(x: number, z: number): GameState["callerPosition"] {
  let nearest: GameState["callerPosition"] = "center";
  let minDist = Infinity;
  for (const [sec, [sx, sz]] of Object.entries(SECTOR_COORDS)) {
    const d = (x - sx) ** 2 + (z - sz) ** 2;
    if (d < minDist) {
      minDist = d;
      nearest = sec as GameState["callerPosition"];
    }
  }
  return nearest;
}

export class RoomRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 50);
  private caller = new THREE.Group();
  private mimic = new THREE.Group();
  private redDoor = new THREE.Group();
  private lamp: THREE.PointLight;
  private callerTarget = new THREE.Vector3();
  private mimicTarget = new THREE.Vector3(2.4, 0, -1.8);
  private cameraIndex = 0;
  private frame = 0;
  private raf = 0;
  private reducedMotion = false;
  private currentState: GameState | null = null;
  private disposed = false;
  private loadedAssets: THREE.Object3D[] = [];
  private dracoLoader: DRACOLoader | null = null;
  private mixers: THREE.AnimationMixer[] = [];
  private lastFrameAt = performance.now();
  private labelsGroup = new THREE.Group();
  private keys = { up: false, down: false, left: false, right: false };
  public onCallerMoved?: (coords: [number, number, number], sector: GameState["callerPosition"]) => void;

  private playerVelocity = new THREE.Vector2(0, 0);
  private isPlayerControlling = false;
  private lastSyncedSector: GameState["callerPosition"] = "center";
  private lastReportedCoords = new THREE.Vector3();
  private lastMoveReportTime = 0;
  private stridePhase = 0;
  private initialPlacementDone = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") { this.keys.up = true; e.preventDefault(); }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") { this.keys.down = true; e.preventDefault(); }
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { this.keys.left = true; e.preventDefault(); }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { this.keys.right = true; e.preventDefault(); }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") this.keys.up = false;
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") this.keys.down = false;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.keys.right = false;
  };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(640, 360, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x111b17);
    this.scene.fog = new THREE.FogExp2(0x243129, 0.035);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.65;

    const ambient = new THREE.HemisphereLight(0xb6c9bc, 0x364038, 2.4);
    this.scene.add(ambient);
    const fill = new THREE.DirectionalLight(0xd4eee1, 2.6);
    fill.position.set(-2, 5, 4);
    this.scene.add(fill);
    const corridor = new THREE.PointLight(0x73b4a3, 19, 11, 2);
    corridor.position.set(-3.5, 2.5, -2.3);
    this.scene.add(corridor);
    this.lamp = new THREE.PointLight(0xff4930, 30, 12, 2);
    this.lamp.position.set(2.7, 2.4, 0.2);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(256, 256);
    this.scene.add(this.lamp);

    this.buildRoom();
    this.buildWorldExtension();
    this.buildSceneLabels();

    this.caller = this.makePerson(0xc8d3cc, 0x28322f);
    this.caller.userData.entityId = "caller";
    this.caller.position.set(0, 0, 0.8);
    this.callerTarget.set(0, 0, 0.8);
    this.lastReportedCoords.set(0, 0, 0.8);
    this.scene.add(this.caller);

    this.mimic = this.makePerson(0x0c0e0d, 0x020202);
    this.mimic.userData.entityId = "mimic";
    this.mimic.scale.set(1.04, 1.1, 1.04);
    this.mimic.position.set(2.4, 0, -1.8);
    this.mimicTarget.set(2.4, 0, -1.8);
    this.scene.add(this.mimic);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.setCamera(0);
    void this.loadConfiguredModels();
    this.loop();
  }

  private box(id: string, size: [number, number, number], position: [number, number, number], color: number, roughness = 0.9) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness, metalness: roughness < 0.5 ? 0.45 : 0.05, flatShading: true })
    ) as TaggedObject;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.entityId = id;
    mesh.userData.procedural = true;
    this.scene.add(mesh);
    return mesh;
  }

  private buildRoom() {
    this.box("floor", [10, 0.2, 8], [0, -0.1, 0], 0x202723);
    this.box("back_wall", [10, 5, 0.2], [0, 2.5, -4], 0x26302b);
    this.box("left_wall", [0.2, 5, 8], [-5, 2.5, 0], 0x1c2421);
    this.box("right_wall", [0.2, 5, 8], [5, 2.5, 0], 0x30332b);

    const door = this.box("red_door", [1.65, 3.5, 0.18], [-3.55, 1.75, -3.83], 0x611611, 0.55);
    this.redDoor.add(door);
    door.position.set(0, 1.75, 0);
    this.redDoor.position.set(-3.55, 0, -3.83);
    this.scene.add(this.redDoor);
    this.box("door_frame_l", [0.22, 3.9, 0.36], [-4.48, 1.95, -3.7], 0x0c0f0d);
    this.box("door_frame_r", [0.22, 3.9, 0.36], [-2.62, 1.95, -3.7], 0x0c0f0d);

    this.box("desk", [2.7, 0.18, 1.2], [0.2, 1.1, -0.7], 0x3a3025);
    this.box("desk_leg_a", [0.15, 1.05, 0.15], [-0.9, 0.5, -0.95], 0x161713);
    this.box("desk_leg_b", [0.15, 1.05, 0.15], [1.3, 0.5, -0.95], 0x161713);
    this.box("radio", [0.8, 0.45, 0.35], [0.65, 1.42, -0.7], 0x171b18, 0.38);
    this.box("locker", [1.1, 2.7, 0.85], [3.8, 1.35, -3.3], 0x25332e, 0.48);
    this.box("red_lamp", [0.26, 0.22, 0.26], [2.7, 2.4, 0.2], 0xa52014, 0.3);
    this.box("vent", [1.35, 0.8, 0.12], [-1.6, 0.65, -3.86], 0x0f1513, 0.4);
    this.box("clock", [0.85, 0.85, 0.12], [0.2, 3.45, -3.85], 0xb5a26f, 0.75);

    const mirror = this.box("mirror", [1.4, 2.2, 0.08], [4.86, 1.65, -1.8], 0x76928b, 0.1);
    mirror.rotation.y = -Math.PI / 2;

    const cableMaterial = new THREE.LineBasicMaterial({ color: 0x050505 });
    for (let index = 0; index < 5; index += 1) {
      const points = [new THREE.Vector3(-4 + index * 1.6, 4.85, -3.8), new THREE.Vector3(-3.2 + index * 1.6, 3.7, -1.2)];
      const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), cableMaterial);
      cable.userData.procedural = true;
      this.scene.add(cable);
    }
  }

  private buildWorldExtension() {
    this.box("perimeter_north", [17, 4.6, 0.16], [0, 2.3, -6.4], 0x1c2a25);
    this.box("perimeter_south", [17, 4.6, 0.16], [0, 2.3, 5.6], 0x26352d);
    this.box("perimeter_east", [0.16, 4.6, 12], [8.4, 2.3, -0.4], 0x26352d);
    this.box("perimeter_west", [0.16, 4.6, 12], [-8.4, 2.3, -0.4], 0x1b2923);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x354039, roughness: 0.85, metalness: 0.1, flatShading: true });
    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x42615b, emissive: 0x122c28, emissiveIntensity: 0.6, roughness: 0.7 });
    const zones: Array<{ id: string; x: number; z: number; color: number }> = [
      { id: "ARCHIVE", x: 0, z: 0, color: 0xb6c7af },
      { id: "THRESHOLD", x: -4.1, z: -1.5, color: 0xd76b54 },
      { id: "UTILITY", x: 3.1, z: -2.4, color: 0x8fc7b4 },
      { id: "OBSERVATION", x: 3.6, z: 2.3, color: 0xa7bad2 },
      { id: "STAIRWELL", x: -3.1, z: 2.5, color: 0xc1bb8c }
    ];
    for (const zone of zones) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6), floorMaterial);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(zone.x, 0.015, zone.z);
      plate.receiveShadow = true;
      this.scene.add(plate);
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.5, 24), new THREE.MeshBasicMaterial({ color: zone.color, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(zone.x, 0.035, zone.z);
      this.scene.add(marker);
      const light = new THREE.PointLight(zone.color, 8, 4.5, 2);
      light.position.set(zone.x, 2.15, zone.z);
      this.scene.add(light);
    }
    for (const [a, b] of [[zones[0], zones[1]], [zones[0], zones[2]], [zones[0], zones[3]], [zones[0], zones[4]]]) {
      const start = new THREE.Vector3(a.x, 0.03, a.z);
      const end = new THREE.Vector3(b.x, 0.03, b.z);
      const middle = start.clone().add(end).multiplyScalar(0.5);
      const length = start.distanceTo(end);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.16, length), pathMaterial);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = -Math.atan2(b.x - a.x, b.z - a.z);
      strip.position.copy(middle);
      this.scene.add(strip);
    }
    this.box("utility_generator", [0.95, 1.3, 0.7], [4.8, 0.65, -2.5], 0x263934, 0.4);
    this.box("utility_indicator", [0.6, 0.18, 0.04], [4.8, 0.95, -2.13], 0x7bc9b3, 0.2);
    this.box("observation_console", [1.25, 0.75, 0.6], [4.6, 0.65, 2.35], 0x283944, 0.45);
    this.box("observation_screen", [0.85, 0.42, 0.05], [4.6, 0.86, 2.03], 0x71899a, 0.15);
    for (let step = 0; step < 4; step += 1) {
      this.box(`stair_step_${step}`, [1.2, 0.18 + step * 0.13, 0.65], [-4.7, 0.09 + step * 0.065, 1.4 + step * 0.62], 0x726a55, 0.8);
    }
    const shelfColor = 0x526158;
    for (const x of [-4.5, -2.7, 2.7, 4.5]) {
      for (const z of [-2.8, -0.7, 1.5]) {
        if (Math.abs(x) < 3.5 && z > 0) continue;
        this.box(`archive_shelf_${x}_${z}`, [0.23, 1.85, 1.2], [x, 0.925, z], shelfColor, 0.6);
        for (let tier = 0; tier < 3; tier += 1) this.box(`shelf_tier_${x}_${z}_${tier}`, [0.45, 0.08, 1.25], [x, 0.35 + tier * 0.56, z], 0x7b7464, 0.8);
      }
    }
  }

  private setTransform(object: THREE.Object3D, asset: ModelAsset) {
    const scale = asset.scale ?? 1;
    if (Array.isArray(scale)) object.scale.set(...scale);
    else object.scale.setScalar(scale);
    object.position.set(...(asset.position ?? [0, 0, 0]));
    object.rotation.set(...(asset.rotation ?? [0, 0, 0]));
  }

  private hideProcedural(entityId?: string) {
    this.scene.traverse((object) => {
      if (object.userData.procedural && (!entityId || object.userData.entityId === entityId)) object.visible = false;
    });
  }

  private async loadConfiguredModels() {
    try {
      const manifestResponse = await fetch("/models/assets.json", { cache: "no-store" });
      if (!manifestResponse.ok) return;
      const manifest = await manifestResponse.json() as { models?: ModelAsset[] };
      const assets = (manifest.models || []).filter((asset) => asset.enabled && asset.file.endsWith(".glb"));
      const loader = new GLTFLoader();
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath("/draco/");
      loader.setDRACOLoader(this.dracoLoader);
      for (const asset of assets) {
        const gltf = await loader.loadAsync(asset.file);
        if (this.disposed) return;
        const object = gltf.scene;
        object.name = `asset:${asset.id}`;
        object.userData.entityId = asset.id;
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.setTransform(object, asset);

        if (asset.role === "room") {
          object.traverse((child) => {
            // The supplied level is a complete labyrinth shell. Its interior walls
            // occlude every fixed surveillance camera, so retain its floors and
            // stair geometry while the game's own bounded layout supplies walls.
            if (/^(ceiling|wall)/i.test(child.name)) child.visible = false;
          });
          for (const wallId of ["back_wall", "left_wall", "right_wall"]) this.hideProcedural(wallId);
          this.scene.add(object);
        } else if (asset.role === "caller") {
          const prevPosition = this.caller.position.clone();
          const prevRotation = this.caller.rotation.clone();
          this.caller.visible = false;
          object.traverse((child) => {
            if (/^Arm1[LR]_/.test(child.name)) child.rotation.y += (child.name.includes("L_") ? 1 : -1) * 1.25;
          });
          const bounds = new THREE.Box3().setFromObject(object);
          const center = bounds.getCenter(new THREE.Vector3());
          object.position.set(-center.x, -bounds.min.y, -center.z);
          const actor = new THREE.Group();
          actor.name = "asset:caller";
          actor.position.copy(prevPosition);
          actor.rotation.copy(prevRotation);
          actor.add(object);

          // Transfer helper children (billboard label, reticle ring)
          const helpers = [...this.caller.children];
          for (const helper of helpers) {
            if (helper !== object && helper.type !== "Mesh") {
              actor.add(helper);
            }
          }

          this.scene.remove(this.caller);
          this.scene.add(actor);
          this.caller = actor;
          const playableAnimations = gltf.animations.filter(
            (clip) => !/walteraction|turntable|spin|rotate/i.test(clip.name) && !clip.tracks.every((track) => track.name.endsWith(".rotation"))
          );
          if (playableAnimations.length) {
            const mixer = new THREE.AnimationMixer(object);
            mixer.clipAction(playableAnimations[0]).play();
            this.mixers.push(mixer);
          }
        } else if (asset.role === "mimic") {
          const prevPosition = this.mimic.position.clone();
          const prevRotation = this.mimic.rotation.clone();
          this.mimic.visible = false;
          object.traverse((child) => {
            if (/^Arm1[LR]_/.test(child.name)) child.rotation.y += (child.name.includes("L_") ? 1 : -1) * 1.42;
          });
          const bounds = new THREE.Box3().setFromObject(object);
          const center = bounds.getCenter(new THREE.Vector3());
          object.position.set(-center.x, -bounds.min.y, -center.z);
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              child.material = materials.map((material) => {
                const copy = material.clone();
                if (copy instanceof THREE.MeshStandardMaterial) {
                  copy.color.set(0x191a1d);
                  copy.emissive.set(0x410907);
                  copy.emissiveIntensity = 0.65;
                }
                return copy;
              });
            }
          });
          const actor = new THREE.Group();
          actor.name = "asset:mimic";
          actor.position.copy(prevPosition);
          actor.rotation.copy(prevRotation);
          actor.add(object);

          // Transfer helper children (billboard label, reticle ring)
          const helpers = [...this.mimic.children];
          for (const helper of helpers) {
            if (helper !== object && helper.type !== "Mesh") {
              actor.add(helper);
            }
          }

          this.scene.remove(this.mimic);
          this.scene.add(actor);
          this.mimic = actor;
          const playableAnimations = gltf.animations.filter(
            (clip) => !/walteraction|turntable|spin|rotate/i.test(clip.name) && !clip.tracks.every((track) => track.name.endsWith(".rotation"))
          );
          if (playableAnimations.length) {
            const mixer = new THREE.AnimationMixer(object);
            mixer.clipAction(playableAnimations[0]).play();
            this.mixers.push(mixer);
          }
        } else if (asset.id === "red_door") {
          this.hideProcedural("red_door");
          this.redDoor.add(object);
        } else {
          this.hideProcedural(asset.id);
          this.scene.add(object);
        }
        this.loadedAssets.push(asset.role === "caller" ? this.caller : asset.role === "mimic" ? this.mimic : object);
      }
      this.canvas.dataset.modelsReady = "true";
    } catch (error) {
      this.canvas.dataset.modelsError = error instanceof Error ? error.message : "Model load failed";
      console.warn("Configured 3D models could not be loaded; using procedural room:", error);
    }
  }

  private makePerson(skin: number, clothes: number) {
    const group = new THREE.Group();
    const flat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.29, 1), flat(skin));
    head.position.y = 1.65;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.47, 1.05, 6), flat(clothes));
    body.position.y = 0.88;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.72, 0.3), flat(clothes));
    legs.position.y = 0.28;
    for (const mesh of [head, body, legs]) {
      mesh.castShadow = true;
      group.add(mesh);
    }
    return group;
  }

  private createLabel(text: string, color = "#d7ff3f") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 110;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(7, 12, 9, 0.88)";
    if (ctx.roundRect) ctx.roundRect(4, 4, 504, 102, 10);
    else ctx.rect(4, 4, 504, 102);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "bold 30px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 55);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(1.9, 0.42, 1);
    return sprite;
  }

  private buildSceneLabels() {
    const labels: Array<{ text: string; pos: [number, number, number]; color?: string }> = [
      { text: "[SECTOR 01: RED DOOR]", pos: [-3.55, 3.3, -3.83], color: "#ff3d2e" },
      { text: "[WORKSTATION DESK]", pos: [0.2, 1.85, -0.7], color: "#62e5d0" },
      { text: "[RADIO TRANSCEIVER]", pos: [0.65, 1.9, -0.7], color: "#d7ff3f" },
      { text: "[EVIDENCE LOCKER]", pos: [3.8, 3.1, -3.3], color: "#62e5d0" },
      { text: "[CRIMSON ALARM LAMP]", pos: [2.7, 2.7, 0.2], color: "#ff3d2e" },
      { text: "[SURVEILLANCE MIRROR]", pos: [4.86, 2.8, -1.8], color: "#62e5d0" },
      { text: "[WALL VENT DUCT]", pos: [-1.6, 1.4, -3.86], color: "#62e5d0" },
      { text: "[CHRONOMETER CLOCK]", pos: [0.2, 3.9, -3.85], color: "#d7ff3f" },
      { text: "[SECTOR 02: UTILITY BREAKER]", pos: [3.1, 1.5, -2.4], color: "#62e5d0" },
      { text: "[SECTOR 03: OBSERVATION]", pos: [3.6, 1.5, 2.3], color: "#62e5d0" },
      { text: "[SECTOR 04: STAIRWELL]", pos: [-3.1, 1.5, 2.5], color: "#d7ff3f" },
      { text: "[SECTOR 01 THRESHOLD]", pos: [-4.1, 1.0, -1.5], color: "#d76b54" }
    ];

    for (const item of labels) {
      const sprite = this.createLabel(item.text, item.color || "#62e5d0");
      sprite.position.set(...item.pos);
      this.labelsGroup.add(sprite);
    }
    this.scene.add(this.labelsGroup);

    const callerLabel = this.createLabel("[CALLER // MARA]", "#d7ff3f");
    callerLabel.position.set(0, 2.05, 0);
    this.caller.add(callerLabel);

    const callerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.46, 24),
      new THREE.MeshBasicMaterial({ color: 0xd7ff3f, side: THREE.DoubleSide })
    );
    callerRing.rotation.x = -Math.PI / 2;
    callerRing.position.y = 0.04;
    this.caller.add(callerRing);

    const mimicLabel = this.createLabel("[ANOMALY // MIMIC]", "#ff3d2e");
    mimicLabel.position.set(0, 2.1, 0);
    this.mimic.add(mimicLabel);

    const mimicRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.50, 24),
      new THREE.MeshBasicMaterial({ color: 0xff3d2e, side: THREE.DoubleSide })
    );
    mimicRing.rotation.x = -Math.PI / 2;
    mimicRing.position.y = 0.04;
    this.mimic.add(mimicRing);

    const grid = new THREE.GridHelper(18, 18, 0x3d7065, 0x142822);
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
  }

  setCamera(index: number) {
    this.cameraIndex = index % CAMERA_POSES.length;
    const pose = CAMERA_POSES[this.cameraIndex];
    this.camera.position.copy(pose.position);
    this.camera.lookAt(pose.target);
  }

  update(state: GameState) {
    this.currentState = state;
    this.setCamera(state.cameraIndex);

    // Initial placement on first state update:
    if (!this.initialPlacementDone) {
      this.initialPlacementDone = true;
      if (state.callerCoords) {
        this.caller.position.set(...state.callerCoords);
        this.callerTarget.set(...state.callerCoords);
        this.lastReportedCoords.set(...state.callerCoords);
      } else if (POSITIONS[state.callerPosition]) {
        this.caller.position.copy(POSITIONS[state.callerPosition]);
        this.callerTarget.copy(POSITIONS[state.callerPosition]);
        this.lastReportedCoords.copy(POSITIONS[state.callerPosition]);
      }
      this.lastSyncedSector = state.callerPosition;
    } else {
      // Check if external sector change occurred (e.g. from Gemma resolution or game turn)
      if (state.callerPosition !== this.lastSyncedSector) {
        const hasInput = this.keys.up || this.keys.down || this.keys.left || this.keys.right;
        if (!hasInput) {
          if (POSITIONS[state.callerPosition]) {
            this.callerTarget.copy(POSITIONS[state.callerPosition]);
            this.isPlayerControlling = false;
          }
        }
        this.lastSyncedSector = state.callerPosition;
      }
    }

    if (state.mimicPosition === "door" || state.doorsOpen) {
      this.mimicTarget.set(-2.8, 0, -2.5);
    } else if (state.mimicPosition && POSITIONS[state.mimicPosition]) {
      this.mimicTarget.copy(POSITIONS[state.mimicPosition]);
    } else {
      this.mimicTarget.set(2.4, 0, -1.8);
    }

    this.mimic.visible = state.mimicVisible;
    this.redDoor.rotation.y = state.doorsOpen ? -1.05 : 0;
    this.redDoor.position.set(-3.55, 0, -3.83);
    this.lamp.visible = state.powerOn;
    this.scene.background = new THREE.Color(state.powerOn ? 0x111b17 : 0x060908);
  }

  private loop = () => {
    this.frame += 1;
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    if (!this.reducedMotion) this.mixers.forEach((mixer) => mixer.update(delta));
    if (this.currentState && !this.reducedMotion) {
      const danger = this.currentState.danger;
      this.camera.position.x += Math.sin(this.frame * 0.73) * danger * 0.00045;
      this.lamp.intensity = this.currentState.powerOn ? 28 + Math.sin(this.frame * 0.18) * (2 + danger * 0.7) : 0;
      if (this.currentState.mimicVisible) this.mimic.rotation.y = Math.sin(this.frame * 0.015) * 0.12;
    }

    // Manual keyboard movement (Arrows & WASD)
    let inputX = 0;
    let inputZ = 0;
    if (this.keys.up) inputZ -= 1;
    if (this.keys.down) inputZ += 1;
    if (this.keys.left) inputX -= 1;
    if (this.keys.right) inputX += 1;

    const hasInput = inputX !== 0 || inputZ !== 0;
    let targetVx = 0;
    let targetVz = 0;

    if (hasInput) {
      const len = Math.hypot(inputX, inputZ);
      const walkSpeed = 3.2; // Brisk, responsive walking speed
      targetVx = (inputX / len) * walkSpeed;
      targetVz = (inputZ / len) * walkSpeed;
      this.isPlayerControlling = true;
    }

    // Snappy acceleration and smooth friction
    const accelRate = hasInput ? 18.0 : 22.0;
    this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVx, Math.min(1, delta * accelRate));
    this.playerVelocity.y = THREE.MathUtils.lerp(this.playerVelocity.y, targetVz, Math.min(1, delta * accelRate));

    const currentSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.y);

    if (currentSpeed > 0.01) {
      const stepX = this.playerVelocity.x * delta;
      const stepZ = this.playerVelocity.y * delta;

      const [nextX, nextZ] = resolveCollision(
        this.caller.position.x,
        this.caller.position.z,
        this.caller.position.x + stepX,
        this.caller.position.z + stepZ,
        this.currentState,
        0.28
      );

      this.caller.position.x = nextX;
      this.caller.position.z = nextZ;
      this.callerTarget.copy(this.caller.position);

      // Smooth facing rotation along movement direction (shortest arc)
      if (currentSpeed > 0.15) {
        const targetAngle = Math.atan2(this.playerVelocity.x, this.playerVelocity.y);
        let angleDiff = (targetAngle - this.caller.rotation.y) % (Math.PI * 2);
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.caller.rotation.y += angleDiff * Math.min(1, delta * 14.0);
      }

      // Subtle stride bob
      this.stridePhase += delta * 12.0;
      this.caller.position.y = Math.abs(Math.sin(this.stridePhase)) * 0.04;
    } else {
      this.playerVelocity.set(0, 0);
      this.stridePhase = 0;
      this.caller.position.y = THREE.MathUtils.lerp(this.caller.position.y, 0, Math.min(1, delta * 10.0));

      // Autonomous navigation (only when not player-controlled and target is distant)
      if (!this.isPlayerControlling && this.currentState) {
        const distToTarget = Math.hypot(
          this.caller.position.x - this.callerTarget.x,
          this.caller.position.z - this.callerTarget.z
        );
        if (distToTarget > 0.08) {
          this.caller.position.lerp(this.callerTarget, this.reducedMotion ? 1 : Math.min(1, delta * 2.8));
          const tdx = this.callerTarget.x - this.caller.position.x;
          const tdz = this.callerTarget.z - this.caller.position.z;
          const targetAngle = Math.atan2(tdx, tdz);
          let angleDiff = (targetAngle - this.caller.rotation.y) % (Math.PI * 2);
          if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          this.caller.rotation.y += angleDiff * Math.min(1, delta * 8.0);
        }
      }
    }

    // Throttled notification to React to eliminate 60fps re-render lag
    const distFromLastReport = Math.hypot(
      this.caller.position.x - this.lastReportedCoords.x,
      this.caller.position.z - this.lastReportedCoords.z
    );
    const nowMs = performance.now();
    const timeSinceReport = nowMs - this.lastMoveReportTime;
    const sector = findNearestSector(this.caller.position.x, this.caller.position.z);
    const sectorChanged = sector !== this.lastSyncedSector;

    if (
      sectorChanged ||
      (distFromLastReport > 0.12 && timeSinceReport > 90) ||
      (!hasInput && currentSpeed === 0 && distFromLastReport > 0.02)
    ) {
      this.lastReportedCoords.copy(this.caller.position);
      this.lastMoveReportTime = nowMs;
      this.lastSyncedSector = sector;
      this.onCallerMoved?.(
        [this.caller.position.x, this.caller.position.y, this.caller.position.z],
        sector
      );
    }

    if (this.currentState && this.currentState.mimicVisible) {
      this.mimic.position.lerp(this.mimicTarget, this.reducedMotion ? 1 : Math.min(1, delta * 1.8));
      const mdx = this.mimicTarget.x - this.mimic.position.x;
      const mdz = this.mimicTarget.z - this.mimic.position.z;
      if (Math.hypot(mdx, mdz) > 0.1) {
        const targetAngle = Math.atan2(mdx, mdz);
        let angleDiff = (targetAngle - this.mimic.rotation.y) % (Math.PI * 2);
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        this.mimic.rotation.y += angleDiff * Math.min(1, delta * 5.0);
      }
    }

    if (this.cameraIndex === 3) {
      const targetCam = new THREE.Vector3(
        this.caller.position.x,
        2.75,
        this.caller.position.z + 3.4
      );
      this.camera.position.lerp(targetCam, this.reducedMotion ? 1 : Math.min(1, delta * 3.8));
      this.camera.lookAt(this.caller.position.x, 1.0, this.caller.position.z);
    }

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  captureFrame() {
    this.renderer.render(this.scene, this.camera);
    const source = this.canvas;
    const target = document.createElement("canvas");
    target.width = 384;
    target.height = 216;
    const context = target.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, target.width, target.height);
    return target.toDataURL("image/jpeg", 0.58);
  }

  getAssetDiagnostics() {
    return this.loadedAssets.map((object) => {
      const box = new THREE.Box3().setFromObject(object);
      return {
        name: object.name,
        center: box.getCenter(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(2))),
        size: box.getSize(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(2)))
      };
    });
  }

  getRoomNodeDiagnostics() {
    const room = this.scene.getObjectByName("asset:room_archive");
    const nodes: Array<{ name: string; size: number[] }> = [];
    room?.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const size = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
        nodes.push({ name: node.name, size: size.toArray().map((value) => Number(value.toFixed(2))) });
      }
    });
    return nodes;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.dracoLoader?.dispose();
  }
}


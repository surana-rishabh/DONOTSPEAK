import fs from "node:fs";
import path from "node:path";

const buffer = fs.readFileSync(path.resolve("public/models/desk_terminal.glb"));
const chunk0Length = buffer.readUInt32LE(12);
const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

console.log("Nodes in desk_terminal.glb:");
for (let i = 0; i < (gltf.nodes?.length || 0); i++) {
  const node = gltf.nodes[i];
  console.log(`Node ${i}: ${node.name || "unnamed"}, mesh: ${node.mesh}, translation: ${JSON.stringify(node.translation)}, scale: ${JSON.stringify(node.scale)}`);
}

console.log("\nMeshes in desk_terminal.glb:");
for (let i = 0; i < (gltf.meshes?.length || 0); i++) {
  const mesh = gltf.meshes[i];
  for (const prim of mesh.primitives || []) {
    const posAccId = prim.attributes?.POSITION;
    const acc = gltf.accessors[posAccId];
    console.log(`Mesh ${i} (${mesh.name}): min ${JSON.stringify(acc.min)}, max ${JSON.stringify(acc.max)}`);
  }
}

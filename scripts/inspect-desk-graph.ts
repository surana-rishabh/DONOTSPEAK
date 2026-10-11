import fs from "node:fs";
import path from "node:path";

const buffer = fs.readFileSync(path.resolve("public/models/desk_terminal.glb"));
const chunk0Length = buffer.readUInt32LE(12);
const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
const gltf = JSON.parse(jsonStr);

console.log("Root nodes:");
for (const scene of gltf.scenes || []) {
  console.log("Scene nodes:", scene.nodes);
}

for (const nodeIdx of gltf.scenes[0].nodes) {
  printNode(nodeIdx, 0);
}

function printNode(idx, depth) {
  const node = gltf.nodes[idx];
  const indent = "  ".repeat(depth);
  console.log(`${indent}Node ${idx} "${node.name}": rot=${JSON.stringify(node.rotation)}, scale=${JSON.stringify(node.scale)}, trans=${JSON.stringify(node.translation)}`);
  for (const child of node.children || []) {
    printNode(child, depth + 1);
  }
}

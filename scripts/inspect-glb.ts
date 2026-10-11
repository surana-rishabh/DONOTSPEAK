import fs from "node:fs";
import path from "node:path";

const modelsDir = path.resolve("public/models");
const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith(".glb"));

console.log(`Found ${files.length} GLB files in ${modelsDir}`);

for (const file of files) {
  const filePath = path.join(modelsDir, file);
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 20) continue;

  const magic = buffer.toString("utf8", 0, 4);
  if (magic !== "glTF") {
    console.log(`${file}: Not a valid GLTF binary (magic: ${magic})`);
    continue;
  }

  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);
  const chunk0Length = buffer.readUInt32LE(12);
  const chunk0Type = buffer.toString("utf8", 16, 20);

  if (chunk0Type !== "JSON") {
    console.log(`${file}: First chunk is not JSON (${chunk0Type})`);
    continue;
  }

  const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
  try {
    const gltf = JSON.parse(jsonStr);
    
    // Find all position accessors
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const mesh of gltf.meshes || []) {
      for (const prim of mesh.primitives || []) {
        const posAccId = prim.attributes?.POSITION;
        if (posAccId !== undefined && gltf.accessors?.[posAccId]) {
          const acc = gltf.accessors[posAccId];
          if (acc.min && acc.max) {
            minX = Math.min(minX, acc.min[0]);
            minY = Math.min(minY, acc.min[1]);
            minZ = Math.min(minZ, acc.min[2]);
            maxX = Math.max(maxX, acc.max[0]);
            maxY = Math.max(maxY, acc.max[1]);
            maxZ = Math.max(maxZ, acc.max[2]);
          }
        }
      }
    }
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    console.log(`\n=================== ${file} ===================`);
    console.log(`File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Generator: ${gltf.asset?.generator || "unknown"}`);
    console.log(`Extensions: ${JSON.stringify(gltf.extensionsUsed || [])}`);
    console.log(`Meshes: ${gltf.meshes?.length || 0}, Nodes: ${gltf.nodes?.length || 0}`);
    console.log(`Raw Bounds: min [${minX.toFixed(3)}, ${minY.toFixed(3)}, ${minZ.toFixed(3)}]`);
    console.log(`            max [${maxX.toFixed(3)}, ${maxY.toFixed(3)}, ${maxZ.toFixed(3)}]`);
    console.log(`Raw Size:   [${sizeX.toFixed(3)}, ${sizeY.toFixed(3)}, ${sizeZ.toFixed(3)}] (W x H x D)`);
    console.log(`Raw Center: [${centerX.toFixed(3)}, ${centerY.toFixed(3)}, ${centerZ.toFixed(3)}]`);
  } catch (err) {
    console.error(`Error parsing ${file}:`, err);
  }
}

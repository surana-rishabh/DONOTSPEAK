import test from "node:test";
import assert from "node:assert/strict";
import { MeshPhysicalMaterial, SRGBColorSpace, Texture } from "three";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { legacyMaterials } from "../src/render/legacyMaterials.js";

test("legacy radio keeps diffuse/specular textures and uses gloss alpha without changing the asset", async () => {
  const json = { materials: [{ extensions: { KHR_materials_pbrSpecularGlossiness: {
    diffuseFactor: [0.5, 0.4, 0.3, 0.8], specularFactor: [0.12, 0.12, 0.12], glossinessFactor: 0.6,
    diffuseTexture: { index: 0 }, specularGlossinessTexture: { index: 1 }
  } } }, {}] };
  const original = JSON.stringify(json); const assignments: string[] = [];
  const parser = { json, assignTexture: async (params: Record<string, unknown>, name: string, _definition: unknown, colorSpace: string) => {
    assignments.push(name); assert.equal(colorSpace, SRGBColorSpace); return params[name] = new Texture();
  } } as unknown as GLTFParser;
  const plugin = legacyMaterials(parser);
  assert.equal(plugin.getMaterialType!(0), MeshPhysicalMaterial);
  assert.equal(plugin.getMaterialType!(1), null);
  const params: Record<string, any> = {};
  await plugin.extendMaterialParams!(0, params);
  const material = new MeshPhysicalMaterial(params);
  assert.equal(material.opacity, 0.8); assert.equal(material.roughness, 0.4);
  assert.deepEqual(assignments, ["map", "specularColorMap"]);
  const shader = { uniforms: {}, fragmentShader: "#include <roughnessmap_fragment>" };
  params.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /texture2D\(legacyGlossMap, vSpecularColorMapUv\)\.a/);
  assert.equal(JSON.stringify(json), original);
});

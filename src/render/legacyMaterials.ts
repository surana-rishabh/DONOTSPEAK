import { Color, MeshPhysicalMaterial, SRGBColorSpace, type Texture } from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

// Interpret the radio's legacy material at load time; never rewrite the shipped GLB.
export function legacyMaterials(parser: GLTFParser): GLTFLoaderPlugin {
  const name = "KHR_materials_pbrSpecularGlossiness";
  const extension = (index: number) => parser.json.materials?.[index]?.extensions?.[name];
  return {
    name,
    getMaterialType: index => extension(index) ? MeshPhysicalMaterial : null,
    async extendMaterialParams(index, params) {
      const legacy = extension(index); if (!legacy) return;
      const diffuse = legacy.diffuseFactor || [1, 1, 1, 1];
      const specular = legacy.specularFactor || [1, 1, 1];
      const gloss = legacy.glossinessFactor ?? 1;
      const maximum = Math.max(0.04, Math.min(0.99, Math.max(...specular)));
      params.color = new Color().fromArray(diffuse); params.opacity = diffuse[3];
      params.metalness = 0; params.roughness = 1 - gloss;
      params.ior = (1 + Math.sqrt(maximum)) / (1 - Math.sqrt(maximum));
      params.specularColor = new Color().fromArray(specular).multiplyScalar(1 / maximum);
      if (legacy.diffuseTexture) await parser.assignTexture(params, "map", legacy.diffuseTexture, SRGBColorSpace);
      if (legacy.specularGlossinessTexture) {
        await parser.assignTexture(params, "specularColorMap", legacy.specularGlossinessTexture, SRGBColorSpace);
        const texture = params.specularColorMap as Texture;
        params.onBeforeCompile = (shader: { uniforms: Record<string, { value: unknown }>; fragmentShader: string }) => {
          shader.uniforms.legacyGlossMap = { value: texture };
          shader.fragmentShader = `uniform sampler2D legacyGlossMap;\n${shader.fragmentShader}`.replace(
            "#include <roughnessmap_fragment>",
            `float roughnessFactor = clamp(1.0 - ${Number(gloss).toFixed(6)} * texture2D(legacyGlossMap, vSpecularColorMapUv).a, 0.04, 1.0);`
          );
        };
        params.customProgramCacheKey = () => `legacy-spec-gloss:${gloss}`;
      }
    }
  };
}

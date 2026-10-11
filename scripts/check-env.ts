import "dotenv/config";

const hostedGemma = Boolean(process.env.GEMINI_API_KEY?.trim());
const localGemma = Boolean(process.env.GEMMA_BASE_URL?.trim());
const elevenLabs = Boolean(process.env.ELEVENLABS_API_KEY?.trim());

const checks = [
  { name: "Gemma provider", ok: hostedGemma || localGemma, detail: localGemma ? "self-hosted endpoint configured" : hostedGemma ? "Gemini API key configured" : "add GEMINI_API_KEY or GEMMA_BASE_URL" },
  { name: "ElevenLabs", ok: elevenLabs, detail: elevenLabs ? "API key configured" : "add ELEVENLABS_API_KEY" },
  { name: "Female output", ok: true, detail: process.env.ELEVENLABS_FEMALE_VOICE_ID?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() ? "preferred voice configured; runtime validates female metadata" : "runtime selects available female voice; smoke verifies it" }
];

for (const item of checks) console.log(`${item.ok ? "PASS" : "MISSING"}  ${item.name}: ${item.detail}`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;

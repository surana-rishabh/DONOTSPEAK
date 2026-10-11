import "dotenv/config";
import { createScribeToken, synthesizeSpeech, transcribeAudio } from "../server/elevenLabs.js";
import { generateWorldCall } from "../server/worldCompiler.js";

type Check = { provider: string; ok: boolean; detail: string; durationMs: number };

async function check(provider: string, run: () => Promise<string>): Promise<Check> {
  const started = performance.now();
  try {
    return { provider, ok: true, detail: await run(), durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return { provider, ok: false, detail: raw.replace(/[A-Za-z0-9_-]{28,}/g, "[redacted]").slice(0, 320), durationMs: Math.round(performance.now() - started) };
  }
}

const results = await Promise.all([
  check("elevenlabs-scribe", async () => {
    const token = await createScribeToken();
    return `single-use token received (${token.length} chars)`;
  }),
  check("elevenlabs-tts", async () => {
    const audio = await synthesizeSpeech("Control, the room can hear us.");
    return `audio received (${audio.byteLength} bytes)`;
  }),
  check("elevenlabs-recorded-stt", async () => {
    const audio = await synthesizeSpeech("Open the red door.");
    const transcript = await transcribeAudio(Buffer.from(audio).toString("base64"), "audio/mpeg");
    if (!/red|door/i.test(transcript)) throw new Error(`Unexpected transcript: ${transcript.slice(0, 80)}`);
    return `voice round trip: ${transcript.slice(0, 80)}`;
  }),
  check("gemma-world", async () => {
    const result = await generateWorldCall({ callIndex: 2, vocabulary: ["door", "open"], previousOutcome: "escaped" });
    return `${result.call.layoutId}/${result.call.objective} in ${result.durationMs}ms`;
  })
]);

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GenerateCallRequestSchema, TurnRequestSchema } from "../shared/contracts.js";
import { createScribeToken, synthesizeSpeech, transcribeAudio } from "./elevenLabs.js";
import { FALLBACK_CALLS } from "../src/game/catalog.js";
import { fallbackWorldTurn, generateWorldCall, resolveWorldTurn } from "./worldCompiler.js";

const app = express();
const port = Number(process.env.PORT || 8080);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(request: express.Request, response: express.Response, next: express.NextFunction) {
  const key = request.ip || "unknown";
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (bucket.count >= 36) return response.status(429).json({ error: "Semantic channel rate limited. Wait one minute." });
  bucket.count += 1;
  next();
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    gemma: Boolean(process.env.GEMINI_API_KEY || process.env.GEMMA_BASE_URL),
    elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY),
    provider: process.env.GEMMA_BASE_URL ? "self-hosted" : "gemma-4"
  });
});

app.get("/api/scribe-token", rateLimit, async (_request, response) => {
  try {
    response.json({ token: await createScribeToken() });
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : "Voice token unavailable" });
  }
});

app.post("/api/voice/transcribe", rateLimit, async (request, response) => {
  const input = z.object({
    base64: z.string().min(20).max(14_000_000),
    mimeType: z.string().min(3).max(64).default("audio/webm")
  }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid microphone recording payload" });
  try {
    const cleanBase64 = input.data.base64.replace(/^data:audio\/[^;]+;base64,/, "").replace(/\s+/g, "");
    const text = await transcribeAudio(cleanBase64, input.data.mimeType);
    response.json({ text });
  } catch (error) {
    console.warn("Transcription notice:", error instanceof Error ? error.message.slice(0, 240) : "unavailable");
    response.status(503).json({ error: error instanceof Error ? error.message.slice(0, 240) : "Transcription unavailable" });
  }
});

app.post("/api/calls/generate", rateLimit, async (request, response) => {
  const input = GenerateCallRequestSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid call generation request" });
  try {
    const result = await generateWorldCall(input.data);
    response.setHeader("Server-Timing", `gemma;dur=${result.durationMs}`);
    response.json(result);
  } catch (error) {
    console.warn("Gemma call failover:", error instanceof Error ? error.message.slice(0, 240) : "unknown provider error");
    const call = FALLBACK_CALLS[(input.data.callIndex - 1) % FALLBACK_CALLS.length];
    response.json({ call, source: "deterministic", durationMs: 0 });
  }
});

app.post("/api/turns/resolve", rateLimit, async (request, response) => {
  const input = TurnRequestSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid world turn", details: input.error.issues.map((issue) => issue.message) });
  try {
    const result = await resolveWorldTurn(input.data);
    response.setHeader("Server-Timing", `gemma;dur=${result.durationMs}`);
    response.json(result);
  } catch (error) {
    console.warn("Gemma turn failover:", error instanceof Error ? error.message.slice(0, 240) : "unknown provider error");
    response.json({ resolution: fallbackWorldTurn(input.data.state, input.data.transcript), source: "deterministic", durationMs: 0 });
  }
});

app.post("/api/voice/stream", rateLimit, async (request, response) => {
  const input = z.object({ text: z.string().min(1).max(420), speaker: z.enum(["caller", "mimic", "operator"]) }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid voice request" });
  try {
    const voiceId = input.data.speaker === "mimic" ? process.env.ELEVENLABS_MIMIC_VOICE_ID : process.env.ELEVENLABS_VOICE_ID;
    const audio = await synthesizeSpeech(input.data.text, voiceId);
    response.setHeader("cache-control", "private, max-age=300");
    response.type("audio/mpeg").send(Buffer.from(audio));
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : "Speech synthesis unavailable" });
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
app.use(express.static(dist, { maxAge: "1h" }));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(dist, "index.html")));

app.listen(port, "0.0.0.0", () => console.log(`DO NOT SAY IT listening on http://0.0.0.0:${port}`));

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
app.use("/api", (request, response, next) => {
  const origin = request.get("origin");
  if (origin) {
    try {
      const host = request.hostname;
      const incoming = new URL(origin).hostname;
      if (incoming !== host && !(["localhost", "127.0.0.1"].includes(host) && ["localhost", "127.0.0.1"].includes(incoming))) return response.status(403).json({ error: "Use the game from its own origin." });
    } catch { return response.status(403).json({ error: "Invalid origin" }); }
  }
  next();
});

const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(request: express.Request, response: express.Response, next: express.NextFunction) {
  const key = `${request.ip || "unknown"}:${request.path}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    for (const [id, value] of buckets) if (value.resetAt <= now) buckets.delete(id);
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
    gemma: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GEMMA_BASE_URL?.trim()),
    elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
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
    base64: z.string().min(20).max(1_800_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    mimeType: z.string().regex(/^audio\/(?:webm|mp4|wav|mpeg|mp3|ogg)(?:;codecs=opus)?$/).default("audio/webm"),
    language: z.enum(["en", "hi"]).optional()
  }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid microphone recording payload" });
  try {
    const text = await transcribeAudio(input.data.base64, input.data.mimeType, input.data.language);
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
    console.warn("Gemma call unavailable; curated call used.");
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
    console.warn("Gemma turn unavailable; shared rules used.");
    response.json({ resolution: fallbackWorldTurn(input.data.state, input.data.transcript), source: "deterministic", durationMs: 0 });
  }
});

app.post("/api/voice/stream", rateLimit, async (request, response) => {
  const input = z.object({ text: z.string().trim().min(1).max(420), speaker: z.enum(["caller", "mimic", "operator"]), character: z.string().trim().min(1).max(32), language: z.enum(["en", "hi"]).default("en") }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: "Invalid voice request" });
  try {
    const audio = await synthesizeSpeech(input.data.text, input.data.speaker, input.data.character, input.data.language);
    response.setHeader("cache-control", "no-store");
    response.type("audio/mpeg").send(Buffer.from(audio));
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : "Speech synthesis unavailable" });
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
app.use("/api", (_request, response) => response.status(404).json({ error: "Unknown API endpoint" }));
app.use((error: { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? "Recording is too large. Use a shorter instruction." : "Invalid request body" });
});
app.use(express.static(dist, { maxAge: "1h" }));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(dist, "index.html")));

export const server = app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`DO NOT SAY IT listening on http://localhost:${port}`));

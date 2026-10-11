const API_ROOT = "https://api.elevenlabs.io/v1";
const speechCache = new Map<string, ArrayBuffer>();
const soundCache = new Map<string, ArrayBuffer>();

function requireKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  return key;
}

export async function synthesizeSpeech(text: string, voiceId?: string): Promise<ArrayBuffer> {
  const key = requireKey();
  const selectedVoice = voiceId || process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const cacheKey = `${selectedVoice}:${text}`;
  const cached = speechCache.get(cacheKey);
  if (cached) return cached;
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
  const response = await fetch(`${API_ROOT}/text-to-speech/${encodeURIComponent(selectedVoice)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
      voice_settings: { stability: 0.46, similarity_boost: 0.7, style: 0.25, use_speaker_boost: true }
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs TTS failed (${response.status}): ${await response.text()}`);
  const audio = await response.arrayBuffer();
  speechCache.set(cacheKey, audio);
  return audio;
}

export async function createScribeToken(): Promise<string> {
  const key = requireKey();
  const response = await fetch(`${API_ROOT}/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`ElevenLabs token request failed (${response.status}): ${await response.text()}`);
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("ElevenLabs did not return a realtime token");
  return data.token;
}

export async function generateSoundEffect(prompt: string): Promise<ArrayBuffer> {
  const key = requireKey();
  const cached = soundCache.get(prompt);
  if (cached) return cached;
  const response = await fetch(`${API_ROOT}/sound-generation?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      text: prompt,
      duration_seconds: 2.5,
      prompt_influence: 0.55,
      model_id: "eleven_text_to_sound_v2"
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs SFX failed (${response.status}): ${await response.text()}`);
  const audio = await response.arrayBuffer();
  soundCache.set(prompt, audio);
  return audio;
}

export async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
  const key = requireKey();
  const bytes = Buffer.from(base64, "base64");
  const form = new FormData();
  const extension = mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3"
    : mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac") ? "mp4"
    : mimeType.includes("wav") ? "wav"
    : mimeType.includes("ogg") ? "ogg"
    : "webm";
  form.append("file", new Blob([bytes], { type: mimeType }), `command.${extension}`);
  form.append("model_id", "scribe_v2");
  const response = await fetch(`${API_ROOT}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(20_000),
    body: form
  });
  if (!response.ok) throw new Error(`ElevenLabs STT failed (${response.status}): ${await response.text()}`);
  const data = await response.json() as { text?: string };
  if (!data.text) throw new Error("ElevenLabs returned an empty transcript");
  return data.text;
}

const API_ROOT = "https://api.elevenlabs.io/v1";
const speechCache = new Map<string, ArrayBuffer>();
let voiceCatalog: { voices: ElevenVoice[]; expires: number } | null = null;

export type ElevenVoice = { voice_id: string; name: string; labels?: Record<string, string> };
export type VoiceSpeaker = "caller" | "mimic" | "operator";
export type VoiceProfile = { voiceId: string; stability: number; similarityBoost: number; style: number; speed: number };

export function chooseVoiceProfile(voices: ElevenVoice[], speaker: VoiceSpeaker, character: string, configuredId?: string): VoiceProfile {
  const configured = configuredId ? voices.find((voice) => voice.voice_id === configuredId) : undefined;
  if (configuredId && !configured) throw new Error("Configured voice was not found in ElevenLabs");
  if (configured && configured.labels?.gender?.toLowerCase() !== "female") throw new Error("Configured ElevenLabs voice must be a female voice");
  const women = voices.filter((voice) => voice.labels?.gender?.toLowerCase() === "female");
  if (!configured && !women.length) throw new Error("No female voice available on this ElevenLabs account");
  const hash = [...character.toLowerCase()].reduce((value, letter) => ((value * 31) + letter.charCodeAt(0)) >>> 0, 7);
  const roleOffset = speaker === "caller" ? 0 : speaker === "mimic" ? 1 : 2;
  const selected = configured || women[(hash + roleOffset) % women.length];
  const settings = speaker === "mimic"
    ? { stability: 0.24, similarityBoost: 0.86, style: 0.72, speed: 0.88 }
    : speaker === "operator"
      ? { stability: 0.68, similarityBoost: 0.72, style: 0.12, speed: 1.02 }
      : { stability: 0.46, similarityBoost: 0.78, style: 0.34, speed: 0.96 };
  return { voiceId: selected.voice_id, ...settings };
}

async function fetchVoices(): Promise<ElevenVoice[]> {
  if (voiceCatalog && voiceCatalog.expires > Date.now()) return voiceCatalog.voices;
  const response = await fetch(`${API_ROOT}/voices`, { headers: { "xi-api-key": requireKey() }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Voice selection unavailable (${response.status})`);
  const data = await response.json() as { voices?: ElevenVoice[] };
  voiceCatalog = { voices: data.voices || [], expires: Date.now() + 300000 };
  return voiceCatalog.voices;
}

export async function selectFemaleVoice(): Promise<string> {
  const voices = await fetchVoices();
  const explicit = process.env.ELEVENLABS_CALLER_VOICE_ID || process.env.ELEVENLABS_FEMALE_VOICE_ID;
  const legacy = voices.find((voice) => voice.voice_id === process.env.ELEVENLABS_VOICE_ID && voice.labels?.gender?.toLowerCase() === "female")?.voice_id;
  return chooseVoiceProfile(voices, "caller", "Mara Vale", explicit || legacy).voiceId;
}

function requireKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
  return key;
}

export async function synthesizeSpeech(text: string, speaker: VoiceSpeaker = "caller", character = "Mara Vale", language: "en" | "hi" = /[\u0900-\u097f]/.test(text) ? "hi" : "en"): Promise<ArrayBuffer> {
  const key = requireKey();
  const voices = await fetchVoices();
  const explicit = process.env[`ELEVENLABS_${speaker.toUpperCase()}_VOICE_ID`] || (speaker === "caller" ? process.env.ELEVENLABS_FEMALE_VOICE_ID : undefined);
  const legacy = speaker === "caller" ? voices.find((voice) => voice.voice_id === process.env.ELEVENLABS_VOICE_ID && voice.labels?.gender?.toLowerCase() === "female")?.voice_id : undefined;
  const profile = chooseVoiceProfile(voices, speaker, character, explicit || legacy);
  const model = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
  const cacheKey = `${profile.voiceId}:${model}:${language}:${speaker}:${character}:${text}`;
  const cached = speechCache.get(cacheKey);
  if (cached) return cached;
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
  if (!outputFormat.startsWith("mp3_")) throw new Error("ELEVENLABS_OUTPUT_FORMAT must use MP3 for browser playback");
  const response = await fetch(`${API_ROOT}/text-to-speech/${encodeURIComponent(profile.voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      text,
      model_id: model,
      language_code: language,
      voice_settings: { stability: profile.stability, similarity_boost: profile.similarityBoost, style: profile.style, speed: profile.speed, use_speaker_boost: true }
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs TTS unavailable (${response.status})`);
  const audio = await response.arrayBuffer();
  if (speechCache.size >= 48) speechCache.delete(speechCache.keys().next().value!);
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
  if (!response.ok) throw new Error(`ElevenLabs token unavailable (${response.status})`);
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("ElevenLabs did not return a realtime token");
  return data.token;
}

export async function transcribeAudio(base64: string, mimeType: string, language?: "en" | "hi"): Promise<string> {
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
  if (language) form.append("language_code", language === "hi" ? "hin" : "eng");
  form.append("tag_audio_events", "false");
  const response = await fetch(`${API_ROOT}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(20_000),
    body: form
  });
  if (!response.ok) throw new Error(`ElevenLabs STT unavailable (${response.status})`);
  const data = await response.json() as { text?: string };
  return data.text?.trim().slice(0, 240) || "";
}

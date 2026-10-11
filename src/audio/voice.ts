import { describeMicrophoneAccessError, diagnoseMicrophoneEnvironment } from "./pushToTalk";
import type { Language } from "../../shared/rules";
export type VoiceCallbacks = { onPartial: (text: string) => void; onCommit: (text: string) => void; onStatus: (status: "connecting" | "live" | "muted" | "transcribing" | "offline", detail?: string) => void };
type RecognitionResult = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }> };
type BrowserRecognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: RecognitionResult) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void; abort: () => void };

export class VoiceChannel {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private callbacks: VoiceCallbacks | null = null;
  private context: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private speechAbort: AbortController | null = null;
  private transcriptAbort: AbortController | null = null;
  private recognition: BrowserRecognition | null = null;
  private generation = 0;
  private recordingTimer = 0;
  private language: Language = "en";
  private browserText = "";
  private recording = false;
  private speechSerial = 0;
  get isConnected() { return Boolean(this.stream?.getAudioTracks().some((track) => track.readyState === "live")); }
  async unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }
  setLanguage(language: Language) { this.language = language; }
  async connect(callbacks: VoiceCallbacks, language: Language = "en") {
    this.closeInput(); this.callbacks = callbacks; this.language = language;
    const generation = this.generation; callbacks.onStatus("connecting", "Allow microphone access to use voice.");
    const environment = diagnoseMicrophoneEnvironment({ isSecureContext: window.isSecureContext, hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia), hostname: location.hostname });
    if (environment) throw new Error(environment);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
      if (!stream.getAudioTracks().length || !window.MediaRecorder) { stream.getTracks().forEach((t) => t.stop()); throw new Error("Microphone recording is unavailable in this browser."); }
      this.stream = stream; this.mute(); callbacks.onStatus("muted", "Hold the button or V to speak. Release to send.");
    } catch (error) { throw new Error(describeMicrophoneAccessError(error instanceof DOMException ? error : { message: String(error) })); }
  }
  unmute() {
    if (!this.isConnected || !this.stream) throw new Error("Enable the microphone first.");
    if (this.recorder || this.transcriptAbort) return;
    this.stopSpeech(); this.browserText = ""; this.recording = true;
    const generation = this.generation;
    this.stream.getAudioTracks().forEach((t) => { t.enabled = true; });
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((value) => MediaRecorder.isTypeSupported(value));
    const recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder = recorder; const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (generation !== this.generation) return;
      this.recorder = null;
      if (this.recording) void this.transcribe(new Blob(chunks, { type: recorder.mimeType }), generation);
    };
    recorder.start();
    const BrowserSpeech = (window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => BrowserRecognition }).webkitSpeechRecognition;
    if (BrowserSpeech) {
      const recognition = new BrowserSpeech(); this.recognition = recognition;
      recognition.lang = this.language === "hi" ? "hi-IN" : "en-IN"; recognition.continuous = true; recognition.interimResults = true;
      let finalText = "";
      recognition.onresult = (event) => {
        if (generation !== this.generation || !this.recording) return;
        let partial = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]; if (result.isFinal) finalText += `${result[0].transcript} `; else partial += result[0].transcript;
        }
        this.browserText = `${finalText}${partial}`.trim(); this.callbacks?.onPartial(this.browserText);
      };
      recognition.onerror = () => undefined;
      try { recognition.start(); } catch { /* Recorded Scribe path still works. */ }
    }
    this.callbacks?.onStatus("live", this.language === "hi" ? "सुन रही हूँ… छोड़ने पर भेजें।" : "Listening… release to send.");
    this.recordingTimer = window.setTimeout(() => this.finishUtterance(), 15000);
  }
  finishUtterance() {
    window.clearTimeout(this.recordingTimer);
    if (!this.recorder || this.recorder.state !== "recording") return "realtime" as const;
    this.recognition?.stop(); this.recorder.stop();
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    this.callbacks?.onStatus("transcribing", this.language === "hi" ? "आपकी बात लिख रही हूँ…" : "Transcribing your instruction…");
    return "recording" as const;
  }
  mute() {
    window.clearTimeout(this.recordingTimer); this.recording = false;
    this.recognition?.abort(); this.recognition = null;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }
  private async transcribe(audio: Blob, generation: number) {
    this.recording = false;
    const controller = new AbortController(); this.transcriptAbort = controller;
    let detail = "Ready. Hold V or the button to speak.";
    try {
      if (audio.size < 300) throw new Error("No speech captured. Hold to speak for a little longer.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(audio);
      });
      const response = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ base64, mimeType: audio.type, language: this.language }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]) });
      const result = await response.json() as { text?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Transcription unavailable.");
      if (generation !== this.generation) return;
      const text = result.text?.trim().slice(0, 240);
      if (text) { this.callbacks?.onCommit(text); detail = "Instruction received."; }
      else detail = "No speech detected. Try again, or type your instruction.";
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const text = this.browserText.trim().slice(0, 240);
      if (text) { this.callbacks?.onCommit(text); detail = "Browser transcription used; Scribe unavailable."; }
      else detail = error instanceof Error ? error.message : "Voice unavailable. Type your instruction.";
    } finally {
      if (generation === this.generation) { this.transcriptAbort = null; this.browserText = ""; this.callbacks?.onStatus("muted", detail); }
    }
  }
  private closeInput() {
    this.generation++; this.mute(); this.transcriptAbort?.abort(); this.transcriptAbort = null;
    this.recorder = null; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
  }
  stopSpeech() {
    this.speechSerial++; this.speechAbort?.abort(); this.speechAbort = null;
    try { this.activeSource?.stop(); } catch { /* Playback already finished. */ }
    this.activeSource = null; window.speechSynthesis?.cancel();
  }
  close() { this.closeInput(); this.stopSpeech(); }
  async speak(text: string, speaker: "caller" | "mimic" | "operator", volume = 1) {
    this.stopSpeech(); if (volume <= 0) return true;
    const serial = this.speechSerial; const controller = new AbortController(); this.speechAbort = controller;
    try {
      await this.unlock();
      const response = await fetch("/api/voice/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, speaker, language: /[\u0900-\u097f]/.test(text) ? "hi" : "en" }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(16000)]) });
      if (!response.ok) throw new Error("Speech unavailable");
      const context = this.context!; const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (serial !== this.speechSerial) return false;
      const source = context.createBufferSource(); const gain = context.createGain(); source.buffer = buffer;
      gain.gain.value = Math.max(0, Math.min(1, volume)); source.playbackRate.value = 0.94;
      source.connect(gain).connect(context.destination); this.activeSource = source;
      await new Promise<void>((resolve) => { source.onended = () => { source.disconnect(); gain.disconnect(); if (this.activeSource === source) this.activeSource = null; resolve(); }; source.start(); });
      return serial === this.speechSerial;
    } catch {
      if (serial !== this.speechSerial) return false;
      const synthesis = window.speechSynthesis; if (!synthesis) return false;
      const language = /[\u0900-\u097f]/.test(text) ? "hi" : "en";
      const voices = synthesis.getVoices();
      const female = voices.find((v) => v.lang.startsWith(language) && /zira|heera|swara|sonia|hazel|susan|samantha|female|google हिन्दी|google us english/i.test(v.name));
      if (!female) return false;
      const utterance = new SpeechSynthesisUtterance(text); utterance.voice = female; utterance.lang = female.lang; utterance.rate = 0.9; utterance.volume = volume;
      return new Promise<boolean>((resolve) => { utterance.onend = () => resolve(serial === this.speechSerial); utterance.onerror = () => resolve(false); synthesis.speak(utterance); });
    }
  }
}

export class AmbientDirector {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  async start(volume = 0.3) {
    if (this.context) { await this.context.resume(); return; }
    const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = 43; gain.gain.value = volume * 0.025;
    oscillator.connect(gain).connect(context.destination); oscillator.start(); this.context = context; this.gain = gain;
  }
  setVolume(volume: number) { if (this.gain) this.gain.gain.value = volume * 0.025; }
  hit() { /* The caller's voice is the primary feedback; no overlapping alarm. */ }
}

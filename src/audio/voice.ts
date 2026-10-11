import { describeMicrophoneAccessError, diagnoseMicrophoneEnvironment } from "./pushToTalk";
import type { Language } from "../../shared/rules";
import { mixForTension, type AudioPhase, type SuspenseMix } from "./audioDesign";
import { sampleSpeech } from "./speechActivity";
export type VoiceCallbacks = { onPartial: (text: string) => void; onCommit: (text: string) => void; onStatus: (status: "connecting" | "live" | "muted" | "transcribing" | "offline", detail?: string) => void };
type RecognitionResult = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }> };
type BrowserRecognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: RecognitionResult) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void; abort: () => void };

export class VoiceChannel {
  lastSpeechError = "";
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private callbacks: VoiceCallbacks | null = null;
  private context: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeGain: GainNode | null = null;
  private speechAbort: AbortController | null = null;
  private transcriptAbort: AbortController | null = null;
  private recognition: BrowserRecognition | null = null;
  private generation = 0;
  private recordingTimer = 0;
  private listening = false;
  private activityTimer = 0;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private language: Language = "en";
  private browserText = "";
  private recording = false;
  private speechSerial = 0;
  private volume = 1;
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
      if (!stream.getAudioTracks().length || !window.MediaRecorder) { stream.getTracks().forEach((t) => t.stop()); throw new Error("Microphone recording is unavailable in this browser."); }
      this.stream = stream;
      await this.unlock();
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.microphoneSource = this.context!.createMediaStreamSource(stream);
      this.analyser = this.context!.createAnalyser(); this.analyser.fftSize = 1024;
      this.microphoneSource.connect(this.analyser);
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (generation !== this.generation) return; this.closeInput(); callbacks.onStatus("offline", "Microphone disconnected. Enable it again to retry."); }; });
      this.mute(); callbacks.onStatus("muted", "Microphone ready. Speak naturally; pause to send.");
    } catch (error) { if (generation === this.generation) this.closeInput(); throw new Error(describeMicrophoneAccessError(error instanceof DOMException ? error : { message: String(error) })); }
  }
  setListening(enabled: boolean) {
    this.listening = enabled;
    if (enabled) this.unmute();
    else if (!this.recorder || this.recorder.state === "recording") this.mute();
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
      else if (this.listening) this.unmute();
    };
    recorder.start();
    const activity = { voicedMs: 0, lastVoice: performance.now(), lastSample: performance.now() };
    const BrowserSpeech = (window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => BrowserRecognition }).webkitSpeechRecognition;
    if (BrowserSpeech) {
      const recognition = new BrowserSpeech(); this.recognition = recognition;
      recognition.lang = this.language === "hi" ? "hi-IN" : "en-IN"; recognition.continuous = true; recognition.interimResults = true;
      let finalText = "";
      recognition.onresult = (event) => {
        if (generation !== this.generation || !this.recording || this.recognition !== recognition) return;
        let partial = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]; if (result.isFinal) finalText += `${result[0].transcript} `; else partial += result[0].transcript;
        }
        this.browserText = `${finalText}${partial}`.trim(); this.callbacks?.onPartial(this.browserText);
        if (this.browserText) { activity.voicedMs = Math.max(180, activity.voicedMs); activity.lastVoice = performance.now(); }
      };
      recognition.onerror = () => undefined;
      try { recognition.start(); } catch { /* Recorded Scribe path still works. */ }
    }
    this.callbacks?.onStatus("live", this.language === "hi" ? "सुन रही हूँ… थोड़ी देर रुकने पर भेजूँगी।" : "Listening… pause briefly to send.");
    const samples = new Float32Array(this.analyser!.fftSize);
    this.activityTimer = window.setInterval(() => {
      this.analyser?.getFloatTimeDomainData(samples);
      let energy = 0; for (const value of samples) energy += value * value;
      if (sampleSpeech(activity, Math.sqrt(energy / samples.length), performance.now())) this.finishUtterance();
    }, 60);
    this.recordingTimer = window.setTimeout(() => {
      if (activity.voicedMs >= 180 || this.browserText.trim()) this.finishUtterance();
      else { this.mute(); this.callbacks?.onStatus("muted", "Listening for your next instruction…"); }
    }, 15000);
  }
  finishUtterance() {
    window.clearTimeout(this.recordingTimer);
    window.clearInterval(this.activityTimer);
    if (!this.recorder || this.recorder.state !== "recording") return "realtime" as const;
    this.recognition?.stop(); this.recorder.stop();
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    this.callbacks?.onStatus("transcribing", this.language === "hi" ? "आपकी बात लिख रही हूँ…" : "Transcribing your instruction…");
    return "recording" as const;
  }
  mute() {
    window.clearInterval(this.activityTimer);
    window.clearTimeout(this.recordingTimer); this.recording = false;
    this.recognition?.abort(); this.recognition = null;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }
  private async transcribe(audio: Blob, generation: number) {
    this.recording = false;
    const controller = new AbortController(); this.transcriptAbort = controller;
    let detail = "Ready for your next instruction.";
    try {
      if (audio.size < 300) throw new Error("No speech captured. Speak a little longer, or type your instruction.");
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
    this.listening = false;
    this.generation++; this.mute(); this.transcriptAbort?.abort(); this.transcriptAbort = null;
    this.microphoneSource?.disconnect(); this.analyser?.disconnect(); this.microphoneSource = null; this.analyser = null;
    this.recorder = null; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
  }
  stopSpeech() {
    this.speechSerial++; this.speechAbort?.abort(); this.speechAbort = null;
    try { this.activeSource?.stop(); } catch { /* Playback already finished. */ }
    this.activeSource = null; this.activeGain = null; window.speechSynthesis?.cancel();
  }
  close() { this.closeInput(); this.stopSpeech(); }
  disconnectMicrophone() { this.closeInput(); }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.activeGain && this.context) this.activeGain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.04);
  }
  async speak(text: string, speaker: "caller" | "mimic" | "operator", character: string, language: Language = this.language) {
    this.lastSpeechError = "";
    this.stopSpeech(); if (this.volume <= 0) return true;
    const serial = this.speechSerial; const controller = new AbortController(); this.speechAbort = controller;
    try {
      await this.unlock();
      const response = await fetch("/api/voice/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, speaker, character, language }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(16000)]) });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || `Speech unavailable (${response.status})`);
      }
      const context = this.context!; const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (serial !== this.speechSerial) return false;
      const source = context.createBufferSource(); const gain = context.createGain(); source.buffer = buffer;
      gain.gain.value = this.volume; source.playbackRate.value = 0.94;
      source.connect(gain).connect(context.destination); this.activeSource = source; this.activeGain = gain;
      await new Promise<void>((resolve) => { source.onended = () => { source.disconnect(); gain.disconnect(); if (this.activeSource === source) { this.activeSource = null; this.activeGain = null; } resolve(); }; source.start(); });
      return serial === this.speechSerial;
    } catch (error) {
      if (controller.signal.aborted) return false;
      this.lastSpeechError = error instanceof Error ? error.message : "Voice playback unavailable";
      console.warn("ElevenLabs playback unavailable:", error instanceof Error ? error.message : "unknown playback error");
      return false;
    }
  }
}

export class AmbientDirector {
  private track: HTMLAudioElement | null = null;
  private trackGain: GainNode | null = null;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: Array<{ gain: GainNode; key: keyof Pick<SuspenseMix, "drone" | "buzz" | "pulse" | "noise" | "music"> }> = [];
  private sources: AudioScheduledSourceNode[] = [];
  private volume = 0.3;
  private impactRate = 0;
  private impactTimer = 0;
  private lastState: [number, boolean, AudioPhase, boolean] = [0, false, "onboarding", false];
  private visibility = () => {
    if (!this.context) return;
    if (document.hidden) { this.track?.pause(); void this.context.suspend(); }
    else { void this.context.resume(); this.setTension(...this.lastState); }
  };
  async start(volume = 0.3) {
    this.volume = volume;
    if (this.context) { await this.context.resume(); return; }
    const context = new AudioContext(); const master = context.createGain();
    master.gain.value = volume * 0.24; master.connect(context.destination);
    this.context = context; this.master = master;
    const oscillator = (type: OscillatorType, frequency: number, key: "drone" | "buzz" | "pulse" | "music", filterType: BiquadFilterType, filterFrequency: number) => {
      const source = context.createOscillator(); const filter = context.createBiquadFilter(); const gain = context.createGain();
      source.type = type; source.frequency.value = frequency; filter.type = filterType; filter.frequency.value = filterFrequency; filter.Q.value = 1.4; gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(master); source.start(); this.sources.push(source); this.layers.push({ gain, key });
    };
    oscillator("sine", 43, "drone", "lowpass", 150);
    oscillator("sawtooth", 118, "buzz", "bandpass", 220);
    oscillator("sine", 31, "pulse", "lowpass", 90);
    const track = new Audio("/audio/suspense-tension.mp3"); track.loop = true; track.preload = "none";
    const trackGain = context.createGain(); trackGain.gain.value = 0;
    context.createMediaElementSource(track).connect(trackGain).connect(master);
    this.track = track; this.trackGain = trackGain;
    void track.play().catch(() => undefined);
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate); const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    const noise = context.createBufferSource(); const noiseFilter = context.createBiquadFilter(); const noiseGain = context.createGain();
    noise.buffer = buffer; noise.loop = true; noiseFilter.type = "bandpass"; noiseFilter.frequency.value = 620; noiseFilter.Q.value = 0.7; noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(master); noise.start(); this.sources.push(noise); this.layers.push({ gain: noiseGain, key: "noise" });
    this.impactTimer = window.setInterval(() => { if (this.context?.state === "running" && Math.random() < this.impactRate) this.impact(0.45); }, 2600);
    document.addEventListener("visibilitychange", this.visibility);
    this.setTension(...this.lastState);
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.master && this.context) this.master.gain.setTargetAtTime(volume * 0.24, this.context.currentTime, 0.12);
  }
  setTension(danger: number, mimicVisible: boolean, phase: AudioPhase, ducked: boolean) {
    this.lastState = [danger, mimicVisible, phase, ducked];
    const mix = mixForTension(danger, mimicVisible, phase, ducked); this.impactRate = mix.impactRate;
    if (!this.context) return;
    for (const layer of this.layers) layer.gain.gain.setTargetAtTime(mix[layer.key], this.context.currentTime, 0.5);
    const inCall = phase === "active" || phase === "resolving";
    this.trackGain?.gain.setTargetAtTime(inCall ? mix.music * 8 : 0, this.context.currentTime, 0.3);
    if (this.track) {
      if (inCall && this.track.paused) void this.track.play().catch(() => undefined);
      else if (!inCall) this.track.pause();
    }
  }
  private impact(strength: number) {
    if (!this.context || this.context.state !== "running" || !this.master || !this.volume) return;
    const source = this.context.createOscillator(); const gain = this.context.createGain(); const now = this.context.currentTime;
    source.type = "sine"; source.frequency.setValueAtTime(94, now); source.frequency.exponentialRampToValueAtTime(38, now + 0.34);
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.12 * strength, now + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    source.connect(gain).connect(this.master); source.start(now); source.stop(now + 0.45);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
  hit() { this.impact(1); }
  stop() {
    this.track?.pause(); this.track?.removeAttribute("src"); this.track?.load(); this.track = null; this.trackGain = null;
    window.clearInterval(this.impactTimer); document.removeEventListener("visibilitychange", this.visibility);
    for (const source of this.sources) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.sources = []; this.layers = []; void this.context?.close(); this.context = null; this.master = null;
  }
}

import { CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from "@elevenlabs/client";
import { describeMicrophoneAccessError, diagnoseMicrophoneEnvironment, finishPushToTalk, waitForMicrophoneReady } from "./pushToTalk";

export type VoiceCallbacks = {
  onPartial: (text: string) => void;
  onCommit: (text: string) => void;
  onStatus: (status: "connecting" | "live" | "muted" | "transcribing" | "offline", detail?: string) => void;
};

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export class VoiceChannel {
  private connection: RealtimeConnection | null = null;
  private realtimeReady = false;
  private fallbackStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingStartedAt = 0;
  private recordingHasSpeech = false;
  private continuous = false;
  private analyser: AnalyserNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private vadTimer = 0;
  private lastSpeechAt = 0;
  private generation = 0;
  private callbacks: VoiceCallbacks | null = null;
  private context: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private speechRecognition: any = null;
  private speechActive = false;
  private currentSpokenText = "";

  get isConnected() { return Boolean(this.fallbackStream?.getAudioTracks().some((track) => track.readyState === "live")); }

  async unlock() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  async connect(callbacks: VoiceCallbacks) {
    this.close();
    const generation = this.generation;
    this.callbacks = callbacks;
    callbacks.onStatus("connecting");
    const environmentError = diagnoseMicrophoneEnvironment({
      isSecureContext: window.isSecureContext,
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      hostname: window.location.hostname
    });
    if (environmentError) throw new Error(environmentError);
    callbacks.onStatus("connecting", "Waiting for browser microphone permission…");
    let permissionStream: MediaStream;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false
      });
    } catch (error) {
      throw new Error(describeMicrophoneAccessError(error instanceof DOMException ? error : { message: String(error) }));
    }
    const permissionTrack = permissionStream.getAudioTracks()[0];
    if (!permissionTrack) throw new Error("The browser granted access but returned no microphone track. Check the selected input device and retry.");
    if (generation !== this.generation) {
      permissionStream.getTracks().forEach((track) => track.stop());
      return null;
    }
    this.fallbackStream = permissionStream;
    if (!window.MediaRecorder) {
      this.close();
      throw new Error("This browser cannot record microphone audio. Use current Chrome or Edge, or typed input.");
    }
    if (this.context) {
      this.inputSource = this.context.createMediaStreamSource(permissionStream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.inputSource.connect(this.analyser);
    }
    permissionTrack.enabled = false;
    callbacks.onStatus("muted", `Microphone ready${permissionTrack.label ? `: ${permissionTrack.label}` : ""}. Hold Space or Speak.`);

    const BrowserSpeech = typeof window !== "undefined"
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;

    if (BrowserSpeech) {
      try {
        const recognition = new BrowserSpeech();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
          if (generation !== this.generation) return;
          let interim = "";
          let final = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0]?.transcript || "";
            if (event.results[i].isFinal) {
              final += transcript;
            } else {
              interim += transcript;
            }
          }
          const spoken = (final || interim).trim();
          if (spoken) {
            this.currentSpokenText = spoken;
            callbacks.onPartial(spoken);
          }
          if (final && this.continuous && final.trim()) {
            callbacks.onCommit(final.trim());
            this.currentSpokenText = "";
          }
        };

        recognition.onerror = (event: any) => {
          if (generation !== this.generation) return;
          console.warn("Browser speech recognition notice:", event.error);
          if (event.error === "not-allowed") {
            callbacks.onStatus("offline", "Microphone access blocked. Click the address bar icon to allow microphone access.");
          }
        };

        recognition.onend = () => {
          if (generation !== this.generation) return;
          if (this.speechActive && this.continuous) {
            try { recognition.start(); } catch { /* ignore */ }
          } else {
            this.speechActive = false;
          }
        };

        this.speechRecognition = recognition;
      } catch (err) {
        console.warn("Native SpeechRecognition unavailable:", err);
      }
    }

    try {
      const response = await fetch("/api/scribe-token");
      if (!response.ok) throw new Error(`Realtime token HTTP ${response.status}`);
      const data = await response.json() as { token?: string };
      if (!data.token) throw new Error("Realtime token missing");
      if (generation !== this.generation) return null;
      const connection = Scribe.connect({
        token: data.token,
        modelId: "scribe_v2_realtime",
        commitStrategy: CommitStrategy.VAD,
        vadSilenceThresholdSecs: 0.65,
        minSpeechDurationMs: 120,
        minSilenceDurationMs: 160,
        keyterms: ["Mara", "door", "mirror", "vent", "operator", "silence"],
        microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      this.connection = connection;
      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        void waitForMicrophoneReady(
          () => Boolean(connection._mediaStreamTrack && connection._mediaStreamTrack.readyState === "live") || connection._closed
        ).then((ready) => {
          if (this.connection !== connection || connection._closed || generation !== this.generation) return;
          if (!ready || !connection._mediaStreamTrack) {
            connection.close();
            return;
          }
          connection.mute();
          this.realtimeReady = true;
          if (this.continuous) connection.unmute();
          callbacks.onStatus(this.continuous ? "live" : "muted", "Realtime transcription ready. Hold to speak.");
        });
      });
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (event) => {
        if (this.realtimeReady && generation === this.generation) callbacks.onPartial(event.text);
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (event) => {
        if (this.realtimeReady && generation === this.generation && event.text.trim()) callbacks.onCommit(event.text.trim());
      });
      connection.on(RealtimeEvents.ERROR, (event) => {
        if (this.connection !== connection || generation !== this.generation) return;
        this.realtimeReady = false;
        connection.close();
        callbacks.onStatus("muted", `Realtime unavailable (${event.error || "connection error"}). Recorded voice remains ready.`);
      });
      connection.on(RealtimeEvents.CLOSE, () => {
        if (this.connection !== connection || generation !== this.generation) return;
        this.connection = null;
        this.realtimeReady = false;
        callbacks.onStatus("muted", "Recorded voice ready. Hold to speak.");
      });
      return connection;
    } catch (error) {
      if (generation === this.generation) callbacks.onStatus("muted", `Recorded voice ready. Realtime unavailable: ${error instanceof Error ? error.message : "connection failed"}`);
      return null;
    }
  }

  mute() {
    this.continuous = false;
    this.speechActive = false;
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch { /* ignore */ }
    }
    window.clearInterval(this.vadTimer);
    this.vadTimer = 0;
    if (this.recorder?.state === "recording") this.stopRecorder(false);
    if (this.realtimeReady && this.connection) this.connection.mute();
    this.fallbackStream?.getAudioTracks().forEach((track) => { track.enabled = false; });
  }

  unmute() {
    this.currentSpokenText = "";
    if (this.speechRecognition) {
      this.speechActive = true;
      try { this.speechRecognition.start(); } catch { /* ignore */ }
    }
    if (this.realtimeReady && this.connection) {
      this.connection.unmute();
    }
    this.startRecorder();
    this.fallbackStream?.getAudioTracks().forEach((track) => { track.enabled = true; });
    this.callbacks?.onStatus("live", "Listening live… Speak your command.");
  }

  finishUtterance() {
    this.speechActive = false;
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch { /* ignore */ }
    }
    if (this.realtimeReady && this.connection) {
      finishPushToTalk(this.connection);
    }
    if (this.recorder?.state === "recording") {
      this.stopRecorder(true);
      return "recording" as const;
    }
    const finalSpeech = this.currentSpokenText.trim();
    this.currentSpokenText = "";
    if (finalSpeech) {
      this.callbacks?.onCommit(finalSpeech);
    }
    this.fallbackStream?.getAudioTracks().forEach((track) => { track.enabled = false; });
    this.callbacks?.onStatus("muted", "Microphone ready. Hold Space or click Speak.");
    return "realtime" as const;
  }

  startContinuous() {
    this.continuous = true;
    this.fallbackStream?.getAudioTracks().forEach((track) => { track.enabled = true; });
    if (this.speechRecognition) {
      this.speechActive = true;
      try { this.speechRecognition.start(); } catch { /* ignore */ }
    }
    if (this.realtimeReady && this.connection) {
      this.connection.unmute();
    }
    this.startRecorder();
    this.callbacks?.onStatus("live", "Hands-free listening active. Speak freely.");
  }

  private startRecorder() {
    if (!this.fallbackStream || this.recorder?.state === "recording") return;
    this.fallbackStream.getAudioTracks().forEach((track) => { track.enabled = true; });
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.fallbackStream, mimeType ? { mimeType } : undefined);
    this.recorder = recorder;
    this.recordedChunks = [];
    this.recordingStartedAt = performance.now();
    this.recordingHasSpeech = false;
    this.lastSpeechAt = 0;
    recorder.ondataavailable = (event) => { if (event.data.size) this.recordedChunks.push(event.data); };
    recorder.start();
    if (this.continuous) this.watchForSilence();
  }

  private watchForSilence() {
    window.clearInterval(this.vadTimer);
    this.vadTimer = window.setInterval(() => {
      if (!this.continuous || this.recorder?.state !== "recording") return;
      const now = performance.now();
      const samples = new Uint8Array(this.analyser?.fftSize || 1024);
      this.analyser?.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + (value - 128) ** 2, 0) / samples.length) / 128;
      if (rms > 0.025) {
        this.recordingHasSpeech = true;
        this.lastSpeechAt = now;
      }
      if (this.recordingHasSpeech && now - this.lastSpeechAt > 850 && now - this.recordingStartedAt > 700) this.stopRecorder(true);
      else if (now - this.recordingStartedAt > 10_000) this.stopRecorder(this.recordingHasSpeech);
    }, 100);
  }

  private stopRecorder(send: boolean) {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") return;
    window.clearInterval(this.vadTimer);
    this.vadTimer = 0;
    const generation = this.generation;
    recorder.onstop = () => {
      if (generation !== this.generation) return;
      const audio = new Blob(this.recordedChunks, { type: recorder.mimeType || "audio/webm" });
      this.recorder = null;
      this.recordedChunks = [];
      if (send && audio.size > 200) void this.transcribeRecording(audio, generation);
      else if (this.continuous) this.startRecorder();
    };
    recorder.stop();
    if (!this.continuous) this.fallbackStream?.getAudioTracks().forEach((track) => { track.enabled = false; });
  }

  private async transcribeRecording(audio: Blob, generation: number) {
    if (audio.size < 300) {
      if (generation === this.generation && this.continuous) this.startRecorder();
      else if (generation === this.generation) this.callbacks?.onStatus("muted", "Microphone ready. Speak your command.");
      return;
    }
    this.callbacks?.onStatus("transcribing", "ElevenLabs is transcribing your command…");
    let statusDetail = "Microphone ready. Hold Space or Speak.";
    try {
      const base64 = await blobToBase64(audio);
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base64, mimeType: audio.type || "audio/webm" })
      });
      const result = await response.json() as { text?: string; error?: string };
      if (!response.ok) throw new Error(result.error || `Transcription HTTP ${response.status}`);
      if (generation !== this.generation) return;
      const text = result.text?.trim();
      if (text) {
        this.callbacks?.onCommit(text);
        statusDetail = `Transcribed: “${text}”`;
      } else {
        const fallback = this.currentSpokenText.trim();
        if (fallback) {
          this.callbacks?.onCommit(fallback);
          statusDetail = `Transcribed: “${fallback}”`;
        } else {
          statusDetail = "No speech detected. Hold Space to speak and try again.";
        }
      }
    } catch (error) {
      statusDetail = `Transcription note: ${error instanceof Error ? error.message : "network error"}`;
      const fallback = this.currentSpokenText.trim();
      if (fallback) {
        this.callbacks?.onCommit(fallback);
      }
    } finally {
      this.currentSpokenText = "";
      if (generation === this.generation && this.continuous) this.startRecorder();
      else if (generation === this.generation) this.callbacks?.onStatus("muted", statusDetail);
    }
  }

  close() {
    this.generation += 1;
    this.continuous = false;
    this.speechActive = false;
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch { /* ignore */ }
      this.speechRecognition = null;
    }
    window.clearInterval(this.vadTimer);
    this.vadTimer = 0;
    if (this.recorder?.state === "recording") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.recorder = null;
    this.connection?.close();
    this.connection = null;
    this.realtimeReady = false;
    this.fallbackStream?.getTracks().forEach((track) => track.stop());
    this.fallbackStream = null;
    this.inputSource?.disconnect();
    this.inputSource = null;
    this.analyser = null;
    try { this.activeSource?.stop(); } catch { /* already stopped */ }
    this.activeSource = null;
  }

  async speak(text: string, speaker: "caller" | "mimic" | "operator", volume = 1) {
    try {
      await this.unlock();
      const response = await fetch("/api/voice/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, speaker })
      });
      if (!response.ok) throw new Error("Voice stream failed");
      if (!this.context) this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const context = this.context;
      if (context.state === "suspended") await context.resume();
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      try { this.activeSource?.stop(); } catch { /* already stopped */ }
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      source.buffer = buffer;
      source.playbackRate.value = speaker === "mimic" ? 0.91 : 1;
      if (speaker === "mimic") {
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1_150;
        filter.Q.value = 0.72;
        source.connect(filter).connect(gain).connect(context.destination);
      } else {
        source.connect(gain).connect(context.destination);
      }
      source.onended = () => { if (this.activeSource === source) this.activeSource = null; };
      this.activeSource = source;
      source.start();
      return true;
    } catch {
      if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = speaker === "mimic" ? 0.72 : 0.92;
        utterance.pitch = speaker === "mimic" ? 0.55 : 0.9;
        utterance.volume = volume;
        speechSynthesis.speak(utterance);
        return true;
      }
      return false;
    }
  }
}

export class AmbientDirector {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;

  async start(volume = 0.22) {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = 43;
    filter.type = "lowpass";
    filter.frequency.value = 95;
    gain.gain.value = volume * 0.055;
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start();
    this.context = context;
    this.gain = gain;
    this.oscillator = oscillator;
  }

  setVolume(volume: number) {
    if (this.gain) this.gain.gain.value = volume * 0.055;
  }

  hit(danger = 1) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 80 + danger * 23;
    gain.gain.setValueAtTime(0.08, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.18);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.2);
  }
}


import { useEffect, useMemo, useRef, useState } from "react";
import { CallBlueprintSchema, TurnResolutionSchema, type CallBlueprint } from "../shared/contracts";
import { AmbientDirector, VoiceChannel } from "./audio/voice";
import { CONCEPT_POWERS } from "./game/catalog";
import {
  applyResolution,
  beginCall,
  clearProgress,
  createInitialState,
  fallbackResolution,
  markResolving,
  sealBySilence,
  snapshot,
  startGeneratedCall,
  startGoldenCall,
  updateCallerCoords,
  withPartial,
  type GameState
} from "./game/engine";
import { RoomView, type RoomViewHandle } from "./render/RoomView";

type Health = { ok: boolean; gemma: boolean; elevenLabs: boolean; provider: string };
type VoiceStatus = "idle" | "connecting" | "live" | "muted" | "transcribing" | "offline";

const voice = new VoiceChannel();
const ambient = new AmbientDirector();

function outcomeCopy(state: GameState) {
  if (state.outcome === "identity_stolen") return {
    kicker: "BAD ENDING // IDENTITY ISSUED",
    title: `IT ANSWERS TO ${state.operatorCodename.toUpperCase()} NOW.`,
    body: "The Department records your shift as successfully completed. You do not remember leaving the building."
  };
  if (state.outcome === "escaped") return {
    kicker: "CONTAINMENT SUCCESS // UNAUTHORIZED METHOD",
    title: "SILENCE WAS THE ONLY WORD IT COULD NOT STEAL.",
    body: "Mara is breathing. Archive Nine is sealed. Human Resources has scheduled a meeting about your lack of communication."
  };
  return {
    kicker: "CALL TERMINATED // PERSONNEL LOSS",
    title: "THE LINE IS EMPTY. SOMETHING IS STILL LISTENING.",
    body: "Your incident report has already been filed in your handwriting."
  };
}

function App() {
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [codename, setCodename] = useState("NIGHTJAR");
  const [typedCommand, setTypedCommand] = useState("");
  const [health, setHealth] = useState<Health>({ ok: false, gemma: false, elevenLabs: false, provider: "offline" });
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceDetail, setVoiceDetail] = useState("");
  const [silenceLeft, setSilenceLeft] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
  const [captions, setCaptions] = useState(true);
  const [volume, setVolume] = useState(0.78);
  const [generating, setGenerating] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const roomRef = useRef<RoomViewHandle | null>(null);
  const stateRef = useRef(state);
  const processRef = useRef<(text: string) => Promise<void>>(async () => undefined);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { ambient.setVolume(volume); }, [volume]);
  useEffect(() => () => voice.close(), []);

  useEffect(() => {
    void fetch("/api/health")
      .then((response) => response.json())
      .then((value: Partial<Health>) => setHealth({
        ok: Boolean(value.ok),
        gemma: Boolean(value.gemma),
        elevenLabs: Boolean(value.elevenLabs),
        provider: typeof value.provider === "string" && value.provider ? value.provider : "gemma"
      }))
      .catch(() => setHealth({ ok: false, gemma: false, elevenLabs: false, provider: "offline" }));
  }, []);

  useEffect(() => {
    if (state.microphoneMode === "live" && state.phase === "active") {
      voice.startContinuous();
    } else if (voice.isConnected) {
      voice.mute();
      setVoiceStatus("muted");
    }
  }, [state.microphoneMode, state.phase]);

  useEffect(() => {
    if (!state.awaitingSilence || state.phase !== "active") {
      setSilenceLeft(0);
      return;
    }
    const deadline = Date.now() + 7_000;
    setSilenceLeft(7);
    const ticker = window.setInterval(() => setSilenceLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 100);
    const timer = window.setTimeout(() => {
      try { voice.mute(); } catch { /* voice may be offline */ }
      setState((current) => sealBySilence(current));
      ambient.hit(1);
    }, 7_000);
    return () => { window.clearInterval(ticker); window.clearTimeout(timer); };
  }, [state.awaitingSilence, state.phase, state.prologueBeat]);

  async function resolveTurn(text: string) {
    const current = stateRef.current;
    const transcript = text.trim();
    if (!transcript || !["active", "resolving"].includes(current.phase) || current.phase === "resolving") return;
    const resolving = markResolving(current, transcript);
    stateRef.current = resolving;
    setState(resolving);
    ambient.hit(Math.max(1, current.danger));

    let result = fallbackResolution(current, transcript);
    let degraded = true;
    try {
      const frameDataUrl = roomRef.current?.captureFrame();
      if (!frameDataUrl) throw new Error("Surveillance frame unavailable");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 18_000);
      const response = await fetch("/api/turns/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frameDataUrl, transcript, state: snapshot(current) }),
        signal: controller.signal
      }).finally(() => window.clearTimeout(timeout));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "World compiler unavailable");
      result = TurnResolutionSchema.parse(data.resolution);
      degraded = data.source === "deterministic";
    } catch {
      degraded = true;
    }

    const next = applyResolution(current, result, degraded);
    stateRef.current = next;
    setState(next);
    void voice.speak(next.caption, next.awaitingSilence ? "mimic" : result.response.speaker, volume)
      .then((played) => { if (!played) setVoiceDetail("Audio playback unavailable; captions remain active."); });
  }
  processRef.current = resolveTurn;

  async function connectVoice() {
    try {
      setVoiceDetail("");
      await voice.connect({
        onPartial: (text) => setState((current) => withPartial(current, text)),
        onCommit: (text) => void processRef.current(text),
        onStatus: (status, detail) => {
          setVoiceStatus(status);
          setVoiceDetail(detail || "");
          if (status === "muted" && stateRef.current.microphoneMode === "live" && stateRef.current.phase === "active") voice.startContinuous();
        }
      });
    } catch (error) {
      setVoiceStatus("offline");
      setVoiceDetail(error instanceof Error ? error.message : "Voice connection failed");
    }
  }

  async function armShift() {
    setFatalError("");
    await Promise.all([
      ambient.start(volume).catch(() => undefined),
      voice.unlock().catch(() => undefined)
    ]);
    const next = startGoldenCall(state, codename);
    stateRef.current = next;
    setState(next);
  }

  async function enterCall() {
    const next = beginCall(stateRef.current);
    stateRef.current = next;
    setState(next);
    void voice.speak(next.caption, "caller", volume)
      .then((played) => { if (!played) setVoiceDetail("Audio playback unavailable; captions remain active."); });
    void connectVoice();
  }

  function pushToTalk(active: boolean) {
    if (state.microphoneMode !== "push") return;
    try {
      if (active) { voice.unmute(); setVoiceStatus("live"); }
      else { setVoiceStatus(voice.finishUtterance() === "recording" ? "transcribing" : "muted"); }
    } catch (error) {
      setVoiceStatus("offline");
      setVoiceDetail(error instanceof Error ? error.message : "Microphone unavailable");
    }
  }

  useEffect(() => {
    let spaceHeld = false;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.code === "Space" || e.key === "v" || e.key === "V") && !spaceHeld) {
        if (stateRef.current.phase === "active" && stateRef.current.microphoneMode === "push") {
          spaceHeld = true;
          e.preventDefault();
          pushToTalk(true);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.key === "v" || e.key === "V") {
        if (spaceHeld) {
          spaceHeld = false;
          e.preventDefault();
          pushToTalk(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  function toggleMicMode() {
    setState((current) => {
      const nextMode = current.microphoneMode === "push" ? "live" : "push";
      if (nextMode === "live") {
        voice.startContinuous();
      } else {
        voice.mute();
      }
      return { ...current, microphoneMode: nextMode };
    });
  }

  function realMute() {
    setState((current) => ({ ...current, microphoneMode: current.microphoneMode === "muted" ? "live" : "muted" }));
  }

  function submitTyped(event?: React.FormEvent) {
    event?.preventDefault();
    if (!typedCommand.trim()) return;
    const text = typedCommand;
    setTypedCommand("");
    void resolveTurn(text);
  }

  async function nextCall() {
    setGenerating(true);
    let blueprint: CallBlueprint | undefined;
    let generatedByFallback = false;
    try {
      const response = await fetch("/api/calls/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callIndex: Math.max(1, state.callIndex + 1), vocabulary: state.vocabulary.map((item) => item.concept), previousOutcome: state.outcome || undefined })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      blueprint = CallBlueprintSchema.parse(data.call);
      generatedByFallback = data.source === "deterministic";
    } catch {
      blueprint = undefined;
    }
    const next = { ...startGeneratedCall(stateRef.current, blueprint), degraded: generatedByFallback || !blueprint };
    stateRef.current = next;
    setState(next);
    setGenerating(false);
  }

  function resetShift() {
    voice.close();
    clearProgress();
    const next = createInitialState();
    stateRef.current = next;
    setState(next);
    setVoiceStatus("idle");
  }

  const handleCallerMove = (coords: [number, number, number], sector: GameState["callerPosition"]) => {
    setState((current) => {
      if (
        current.callerCoords?.[0] === coords[0] &&
        current.callerCoords?.[2] === coords[2] &&
        current.callerPosition === sector
      ) return current;
      const updated = updateCallerCoords(current, coords, sector);
      stateRef.current = updated;
      return updated;
    });
  };

  const partialDanger = useMemo(() => {
    const words = state.partialTranscript.toLowerCase().match(/[a-z']+/g) || [];
    return words.filter((word) => word in CONCEPT_POWERS);
  }, [state.partialTranscript]);
  const endCopy = outcomeCopy(state);

  if (state.phase === "onboarding") return (
    <main className="onboarding-shell">
      <div className="noise" aria-hidden="true" />
      <section className="title-card">
        <p className="department-mark">DEPARTMENT OF UNSAID THINGS // NIGHT OPERATIONS</p>
        <h1>DO NOT<br /><em>SAY IT.</em></h1>
        <p className="premise">Guide trapped callers through impossible rooms. Every concept you speak becomes an ability the thing on the line can use.</p>
        <div className="rule-strip"><span>WATCH</span><i /> <span>DESCRIBE</span><i /> <span>DO NOT NAME</span></div>
      </section>
      <section className="intake-card">
        <span className="form-code">FORM 0 // TEMPORARY IDENTITY</span>
        <label htmlFor="codename">OPERATOR CODENAME</label>
        <input id="codename" value={codename} onChange={(event) => setCodename(event.target.value.replace(/[^a-z0-9_-]/gi, "").slice(0, 24))} maxLength={24} autoFocus />
        <div className="consent-box"><b>MICROPHONE DISCLOSURE</b><p>The game asks for microphone access only after you enter the call. Its live status is always visible. Use the real mute control or typed commands at any time. Audio and transcripts are not stored by this app.</p></div>
        <button className="primary" onClick={armShift} disabled={!codename.trim()}>CLOCK IN <span>↗</span></button>
        <div className="health-row">
          <span className={health.gemma ? "ok" : "off"}>GEMMA {health.gemma ? "READY" : "FALLBACK"}</span>
          <span className={health.elevenLabs ? "ok" : "off"}>ELEVENLABS {health.elevenLabs ? "READY" : "TYPED MODE"}</span>
        </div>
        {fatalError && <p className="fatal">{fatalError}</p>}
      </section>
      <footer>APACHE-2.0 // OPEN-WEIGHT WORLD COMPILER // HEADPHONES RECOMMENDED</footer>
    </main>
  );

  return (
    <main className={`game-shell phase-${state.phase} ${state.danger >= 6 ? "high-danger" : ""} ${reducedMotion ? "reduced-motion" : ""}`}>
      <div className="noise" aria-hidden="true" />
      <header className="terminal-header">
        <div className="wordmark">DO NOT <b>SAY IT</b></div>
        <div className="case-id">CALL {String(state.callIndex).padStart(2, "0")} // {state.blueprint.layoutId.toUpperCase()} // {state.blueprint.caller.name.toUpperCase()}</div>
        <div className={`mic-status status-${voiceStatus}`}><i /> MIC {voiceStatus === "muted" && state.microphoneMode === "push" ? "READY" : voiceStatus.toUpperCase()}</div>
      </header>

      <section className="game-grid">
        <div className="feed-column">
          <div className={`feed-frame ${state.phase === "resolving" ? "compiling" : ""}`}>
            <RoomView ref={roomRef} state={state} reducedMotion={reducedMotion} onCallerMove={handleCallerMove} />
            <div className="crt-lines" />
            <div className="feed-glitch" />
            <div className="feed-meta"><span>REC ●</span><b>CAM 0{state.cameraIndex + 1}</b><span>{new Date().toLocaleTimeString([], { hour12: false })}</span></div>
            <div className="location-overlay">
              <small>SECTOR: {state.callerPosition.toUpperCase()}</small>
              <span>LOC: [{state.callerCoords ? `${state.callerCoords[0].toFixed(1)}, ${state.callerCoords[2].toFixed(1)}` : "0.0, 0.8"}]</span>
              <em>WASD / ARROWS: MOVE</em>
            </div>
            {state.phase === "resolving" && <div className="compiler-overlay"><strong>SEMANTIC COLLISION</strong><span>GEMMA IS READING THE ROOM</span></div>}
            {state.awaitingSilence && <div className="silence-overlay"><small>AUTHORIZATION WINDOW</small><strong>{silenceLeft || 7}</strong><span>YOU DO NOT HAVE TO ANSWER.</span></div>}
          </div>
          <div className="camera-deck">
            {["ARCHIVE", "THRESHOLD", "OVERHEAD", "TRACK (FOLLOW)", "STAIRWELL"].map((sector, camera) => <button key={sector} className={state.cameraIndex === camera ? "active" : ""} onClick={() => setState((current) => ({ ...current, cameraIndex: camera }))}>CAM 0{camera + 1}<small>{sector}</small></button>)}
          </div>
          <div className="sector-map" aria-label="Connected sector map">
            <span>COMPLEX ROUTE</span>
            <div>{["ARCHIVE", "THRESHOLD", "UTILITY", "OBSERVATION", "STAIRWELL"].map((sector) => <b key={sector} className={(state.callerPosition === "center" ? "ARCHIVE" : state.callerPosition.toUpperCase()) === sector ? "occupied" : ""}>{sector}</b>)}</div>
            <small>Switch cameras to survey the route. Guide the caller with your voice or a typed direction.</small>
          </div>
          <div className="caption-card">
            <span>{state.awaitingSilence ? "UNKNOWN SPEAKER" : state.blueprint.caller.name.toUpperCase()}</span>
            {captions && <p>“{state.caption}”</p>}
            {state.interpretation && <small>{state.degraded ? "DEGRADED PARSER" : "GEMMA 4"} // {state.interpretation}</small>}
          </div>
        </div>

        <aside className="operator-console">
          <div className="operator-head"><span>OPERATOR {state.operatorCodename.toUpperCase()}</span><b>DANGER {state.danger}/10</b></div>
          <div className="danger-meter"><i style={{ width: `${state.danger * 10}%` }} /></div>

          <section className="objective-card"><small>CURRENT DIRECTIVE</small><h2>{state.blueprint.objective.replaceAll("_", " ")}</h2><p>{state.blueprint.operatorNotice}</p></section>

          <section className="lexicon">
            <div className="section-title"><span>CREATURE LEXICON</span><b>{String(state.vocabulary.length).padStart(2, "0")} KNOWN</b></div>
            <div className="word-grid">
              {state.vocabulary.length === 0 && <p>Nothing acquired. Keep it that way.</p>}
              {state.vocabulary.map((item) => <article key={item.concept} className={`severity-${item.severity}`}><strong>{item.concept}</strong><small>{item.powerClass.replaceAll("_", " ")}</small></article>)}
            </div>
          </section>

          <section className="transmission">
            <div className="section-title"><span>LIVE TRANSCRIPT</span><b>{voiceStatus.toUpperCase()}</b></div>
            <div className="transcript-line">
              {state.partialTranscript ? state.partialTranscript.split(/\s+/).map((word, index) => <span key={`${word}-${index}`} className={partialDanger.includes(word.toLowerCase().replace(/[^a-z']/g, "")) ? "danger-word" : ""}>{word} </span>) : <em>{voiceStatus === "offline" ? "Voice unavailable. Type below." : "The line is waiting."}</em>}
            </div>
            {state.lastTranscript && <small>LAST COMMIT // “{state.lastTranscript}”</small>}
          </section>

          <div className="voice-controls">
            {voiceStatus === "offline" && <button className="retry-mic" onClick={() => void connectVoice()}>ENABLE / RETRY MICROPHONE</button>}
            <div className="mic-mode-row">
              <button
                type="button"
                className="mic-mode-toggle"
                onClick={toggleMicMode}
                title="Switch between Push-to-Talk and Hands-Free Open Mic"
              >
                MODE: {state.microphoneMode === "push" ? "PUSH-TO-TALK (HOLD [SPACE] / [V])" : "HANDS-FREE (OPEN MIC)"}
              </button>
            </div>
            {state.microphoneMode === "push" ? (
              <button
                className="talk-button"
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pushToTalk(true); }}
                onPointerUp={() => pushToTalk(false)}
                onPointerCancel={() => pushToTalk(false)}
                disabled={state.phase !== "active" || (voiceStatus !== "muted" && voiceStatus !== "live")}
              >
                <i /> {voiceStatus === "connecting" ? "CONNECTING MICROPHONE…" : voiceStatus === "transcribing" ? "TRANSCRIBING…" : "HOLD [SPACE] OR CLICK TO SPEAK"}
              </button>
            ) : (
              <button className={`mute-button ${state.microphoneMode === "muted" ? "muted" : ""}`} onClick={realMute}>
                <i /> {state.microphoneMode === "muted" ? "RESTORE LIVE MIC" : "OPEN MIC ACTIVE (CLICK TO MUTE)"}
              </button>
            )}
            <div className="quick-commands-strip" aria-label="Quick voice transmissions">
              <small>QUICK TRANSMIT:</small>
              <div className="quick-buttons-row">
                {[
                  { label: "🚪 Door", text: "Move to the red door and unseal it" },
                  { label: "🪑 Desk", text: "Duck low behind the workstation desk" },
                  { label: "🪞 Mirror", text: "Inspect the surveillance mirror on the wall" },
                  { label: "💨 Vent", text: "Crouch near the air intake vent duct" },
                  { label: "⚡ Utility", text: "Head to the utility breaker and cut the power" },
                  { label: "🤫 Silence", text: "Hold your breath and stay completely silent" }
                ].map((cmd) => (
                  <button
                    key={cmd.label}
                    type="button"
                    className="quick-cmd-btn"
                    disabled={state.phase !== "active"}
                    onClick={() => void resolveTurn(cmd.text)}
                    title={`Transmit: "${cmd.text}"`}
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>
            </div>
            <form onSubmit={submitTyped}><input value={typedCommand} onChange={(event) => setTypedCommand(event.target.value)} placeholder="Type radio command or hold Space to speak…" maxLength={240} disabled={state.phase !== "active"} /><button type="submit" disabled={state.phase !== "active"}>SEND</button></form>
            {voiceDetail && <small className="voice-detail">{voiceDetail}</small>}
            {!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" && (
              <div className="lan-mic-hint">
                LAN Chrome Notice: Enable microphone in <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> by adding <code>http://{window.location.hostname}:5173</code>
              </div>
            )}
          </div>

          <section className="incident-log">
            <div className="section-title"><span>INCIDENT TAPE</span><b>SCORE {state.score}</b></div>
            {state.log.slice(0, 5).map((entry) => <article key={entry.id} className={entry.type}><span>{entry.type}</span><p>{entry.text}</p></article>)}
          </section>
        </aside>
      </section>

      {state.phase === "briefing" && <section className="comic-panel briefing-panel">
        <div><span>INCOMING // SEMANTIC CONTAINMENT</span><h2>{state.blueprint.caller.name}</h2><p>{state.blueprint.openingLine}</p><small>Known hazard words are never displayed in advance.</small></div>
        <button className="primary" onClick={enterCall}>ANSWER CALL <b>↗</b></button>
      </section>}

      {state.phase === "ended" && <section className={`comic-panel ending-panel ending-${state.outcome}`}>
        <div><span>{endCopy.kicker}</span><h2>{endCopy.title}</h2><p>{endCopy.body}</p><div className="score-stamp"><b>{state.score}</b><small>SHIFT SCORE</small></div></div>
        <div className="ending-actions"><button className="primary" onClick={nextCall} disabled={generating}>{generating ? "GENERATING CALL…" : "FILE REPORT / NEXT CALL"}</button><button onClick={resetShift}>ERASE SHIFT DATA</button></div>
      </section>}

      <footer className="settings-bar">
        <span>{state.degraded ? "△ DETERMINISTIC FALLBACK ACTIVE" : `● ${(health.provider || "GEMMA").toUpperCase()} WORLD COMPILER`}</span>
        <label><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)} /> CAPTIONS</label>
        <label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> REDUCED MOTION</label>
        <label>VOLUME <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
      </footer>
    </main>
  );
}

export default App;

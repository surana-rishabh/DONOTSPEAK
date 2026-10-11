import { useCallback, useEffect, useRef, useState } from "react";
import { CallBlueprintSchema, TurnResolutionSchema, type CallBlueprint } from "../shared/contracts";
import { CONCEPT_ALIASES, extractConcepts, objectiveSteps, STATIONS, type Language } from "../shared/rules";
import { AmbientDirector, VoiceChannel } from "./audio/voice";
import { applyResolution, beginCall, clearProgress, createInitialState, fallbackResolution, markResolving, snapshot, startGeneratedCall, startGoldenCall, withPartial, type GameState } from "./game/engine";
import { RoomView, type RoomViewHandle } from "./render/RoomView";
import type { ScareKind } from "./render/scenePolicy";

type VoiceStatus = "idle" | "connecting" | "live" | "muted" | "transcribing" | "offline";
type Health = { ok: boolean; gemma: boolean; elevenLabs: boolean };
const voice = new VoiceChannel(); const ambient = new AmbientDirector();
function App() {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const [codename, setCodename] = useState("NIGHTJAR");
  const [command, setCommand] = useState("");
  const [health, setHealth] = useState<Health>({ ok: false, gemma: false, elevenLabs: false });
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceDetail, setVoiceDetail] = useState("");
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [plain, setPlain] = useState(false); const [captions, setCaptions] = useState(true);
  const [volume, setVolume] = useState(0.65); const [generating, setGenerating] = useState(false);
  const [speaking, setSpeaking] = useState(false); const [traveling, setTraveling] = useState(false);
  const [captionPosition, setCaptionPosition] = useState({ x: 2, y: 68 });
  const [scareKind, setScareKind] = useState<ScareKind | null>(null); const [endingReady, setEndingReady] = useState(false);
  const [source, setSource] = useState("local");
  const roomRef = useRef<RoomViewHandle>(null); const travelRef = useRef(false);
  const processRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const talkRef = useRef<(active: boolean) => void>(() => undefined);
  const controllerRef = useRef<AbortController | null>(null); const runRef = useRef(0);
  const speechRef = useRef(0);
  const atmosphereRef = useRef({ mimicVisible: state.mimicVisible, phase: state.phase });
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const hi = state.language === "hi"; const t = (en: string, hindi: string) => hi ? hindi : en;
  const commit = useCallback((next: GameState) => { stateRef.current = next; setState(next); }, []);
  const handleTravel = useCallback((moving: boolean) => { travelRef.current = moving; setTraveling(moving); }, []);
  const active = state.phase === "active"; const busy = !active || traveling || voiceStatus === "transcribing";
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal }).then((r) => r.json()).then((data) => setHealth(data)).catch(() => undefined);
    return () => { controller.abort(); controllerRef.current?.abort(); voice.close(); ambient.stop(); };
  }, []);
  useEffect(() => { ambient.setVolume(volume); voice.setVolume(volume); }, [volume]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", updateMotion);
    return () => query.removeEventListener("change", updateMotion);
  }, []);
  useEffect(() => {
    const previous = atmosphereRef.current;
    if ((!previous.mimicVisible && state.mimicVisible) || (previous.phase !== "ended" && state.phase === "ended")) ambient.hit();
    atmosphereRef.current = { mimicVisible: state.mimicVisible, phase: state.phase };
    ambient.setTension(state.danger, state.mimicVisible, state.phase, speaking || voiceStatus === "live");
  }, [state.danger, state.mimicVisible, state.phase, speaking, voiceStatus]);
  useEffect(() => { voice.setLanguage(state.language); document.documentElement.lang = state.language; }, [state.language]);
  useEffect(() => {
    const modal = state.phase === "briefing" || state.phase === "ended";
    const background = document.querySelectorAll<HTMLElement>(".terminal-header, .game-grid, .settings-drawer");
    background.forEach((node) => { node.inert = modal; });
    const trap = (event: KeyboardEvent) => {
      if (!modal || event.key !== "Tab") return;
      const buttons = document.querySelectorAll<HTMLButtonElement>(".modal-scrim button:not(:disabled)");
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); background.forEach((node) => { node.inert = false; }); };
  }, [state.phase]);
  useEffect(() => {
    if (state.phase !== "ended") { setEndingReady(false); return; }
    if (reducedMotion) { setEndingReady(true); return; }
    const timer = window.setTimeout(() => setEndingReady(true), 1050);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.callId, reducedMotion]);

  async function speak(text: string, speaker: "caller" | "mimic" = "caller") {
    const run = runRef.current; const speech = ++speechRef.current; setSpeaking(true);
    const played = await voice.speak(text, speaker, stateRef.current.blueprint.caller.name, stateRef.current.language);
    if (run !== runRef.current || speech !== speechRef.current) return;
    setSpeaking(false);
    if (!played && volume > 0) setVoiceDetail(t("Voice output unavailable; read the captions.", "आवाज़ उपलब्ध नहीं है; नीचे लिखी बात पढ़ें।"));
    else setVoiceDetail("");
  }
  async function resolveTurn(text: string) {
    const current = stateRef.current; const transcript = text.trim().slice(0, 240);
    if (!transcript || current.phase !== "active" || travelRef.current) return;
    const run = runRef.current; speechRef.current++; voice.mute(); voice.stopSpeech(); setSpeaking(false);
    const resolving = markResolving(current, transcript); commit(resolving);
    let resolution = fallbackResolution(resolving, transcript); let nextSource = "local";
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const frameDataUrl = roomRef.current?.captureFrame();
      if (frameDataUrl && health.gemma) {
        const response = await fetch("/api/turns/resolve", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ frameDataUrl, transcript, state: snapshot(resolving) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Game service unavailable");
        resolution = TurnResolutionSchema.parse(data.resolution); nextSource = data.source;
      }
    } catch { nextSource = "local"; }
    if (run !== runRef.current || controller.signal.aborted) return;
    controllerRef.current = null;
    const next = applyResolution(resolving, resolution, !["gemma", "self-hosted"].includes(nextSource));
    commit(next); setSource(nextSource); void speak(next.caption, resolution.response.speaker === "mimic" ? "mimic" : "caller");
  }
  processRef.current = resolveTurn;

  async function connectVoice() {
    if (voiceStatus === "connecting") return;
    try {
      await voice.unlock();
      await voice.connect({ onPartial: (text) => commit(withPartial(stateRef.current, text)),
        onCommit: (text) => void processRef.current(text),
        onStatus: (status, detail) => { setVoiceStatus(status); setVoiceDetail(detail || ""); }
      }, stateRef.current.language);
    } catch (error) { setVoiceStatus("offline"); setVoiceDetail(error instanceof Error ? error.message : "Microphone unavailable"); }
  }
  function pushToTalk(down: boolean) {
    if (!down) { voice.finishUtterance(); return; }
    if (stateRef.current.phase !== "active" || travelRef.current || !voice.isConnected || voiceStatus === "transcribing") return;
    speechRef.current++; setSpeaking(false);
    try { voice.unmute(); } catch (error) { voice.close(); setVoiceStatus("offline"); setVoiceDetail(error instanceof Error ? error.message : "Microphone unavailable. Type your instruction."); }
  }
  talkRef.current = pushToTalk;
  useEffect(() => {
    let held = false;
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "v" || event.repeat || (event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault(); held = true; talkRef.current(true);
    };
    const up = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "v" && held) { held = false; talkRef.current(false); } };
    const blur = () => { if (held) { held = false; voice.mute(); setVoiceStatus("muted"); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  function setLanguage(language: Language) { voice.mute(); commit({ ...stateRef.current, language, partialTranscript: "" }); }
  function reset() {
    runRef.current++; controllerRef.current?.abort(); voice.close(); clearProgress(); handleTravel(false);
    setVoiceStatus("idle"); setVoiceDetail(""); setSpeaking(false); setCommand(""); setSource("local"); setScareKind(null);
    commit({ ...createInitialState(), language: stateRef.current.language });
  }
  async function nextCall() {
    voice.stopSpeech(); setSpeaking(false); setGenerating(true); const run = ++runRef.current;
    let blueprint: CallBlueprint | undefined;
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      if (health.gemma) {
        const response = await fetch("/api/calls/generate", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ callIndex: stateRef.current.callIndex + 1, vocabulary: stateRef.current.vocabulary.map((c) => c.concept), previousOutcome: stateRef.current.outcome }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json(); if (response.ok) blueprint = CallBlueprintSchema.parse(data.call);
      }
    } catch { /* Curated calls remain playable offline. */ }
    if (run === runRef.current) { controllerRef.current = null; commit(startGeneratedCall(stateRef.current, blueprint)); setGenerating(false); }
  }
  function submit(event: React.FormEvent) { event.preventDefault(); if (busy || !command.trim()) return; const text = command; setCommand(""); void resolveTurn(text); }
  function moveCaption(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current; const frame = feedRef.current; const panel = event.currentTarget.parentElement;
    if (!drag || !frame || !panel) return;
    const rect = frame.getBoundingClientRect(); const size = panel.getBoundingClientRect();
    setCaptionPosition({ x: Math.max(1, Math.min((rect.width - size.width - 8) / rect.width * 100, drag.left + (event.clientX - drag.x) / rect.width * 100)),
      y: Math.max(10, Math.min((rect.height - size.height - 8) / rect.height * 100, drag.top + (event.clientY - drag.y) / rect.height * 100)) });
  }
  const languagePicker = <label className="language-picker"><span>{t("Language", "भाषा")}</span><select aria-label={t("Language", "भाषा")} value={state.language} onChange={(e) => setLanguage(e.target.value as Language)} disabled={state.phase === "resolving" || voiceStatus === "live" || voiceStatus === "transcribing"}><option value="en">English</option><option value="hi">हिंदी</option></select></label>;
  if (state.phase === "onboarding") return <main className="onboarding-shell">
    <header className="intro-header"><span className="department-mark">ARCHIVE 09</span>{languagePicker}</header>
    <section className="title-card"><p className="eyebrow">{t("A surveillance voice game", "निगरानी और आवाज़ का खेल")}</p><h1>DO NOT<br /><em>SAY IT.</em></h1>
      <p className="premise">{t("Guide one frightened caller. Every forbidden word teaches the thing listening.", "एक डरे हुए कॉलर को बाहर निकालें। हर खतरनाक शब्द सुन रही चीज़ को सिखाता है।")}</p>
    </section>
    <section className="intake-card"><h2>{t("Take the call.", "कॉल उठाएँ।")}</h2>
      <p>{t("Speak or type in English, Hindi, or Hinglish.", "अंग्रेज़ी, हिंदी या हिंग्लिश में बोलें या लिखें।")}</p>
      <label htmlFor="codename">{t("Operator codename", "ऑपरेटर का कोड")}</label><input id="codename" value={codename} onChange={(e) => setCodename(e.target.value.replace(/[^a-z0-9_-]/gi, "").slice(0, 24))} maxLength={24} />
      <button className="primary" disabled={!codename.trim()} onClick={() => { void ambient.start(volume).catch(() => undefined); void voice.unlock().catch(() => undefined); commit(startGoldenCall(stateRef.current, codename)); }}>{t("Clock in", "खेल शुरू करें")} <span>↗</span></button>
    </section>
  </main>;

  const steps = objectiveSteps({ objective: state.blueprint.objective, language: state.language });
  const keys = ["reach", "act", "confirm"];
  const suggestions: Record<GameState["blueprint"]["objective"], string[]> = {
    escape: hi ? ["लाल निशान तक जाओ", "रुकावट हटाओ", "आगे"] : ["Go to the red mark", "Release the barrier", "Proceed"],
    restore_power: hi ? ["बिजली केंद्र तक जाओ", "केंद्र चालू करो", "पुष्टि"] : ["Go to B", "Activate the station", "Verify"],
    identify_caller: hi ? ["सिग्नल केंद्र तक जाओ", "सिग्नल जाँचो", "रोको", "भरोसा"] : ["Go to C", "Check the signal", "Contain", "Trust"],
    trap_entity: hi ? ["D तक जाओ", "रुको", "क्षेत्र सील करो"] : ["Go to D", "Wait", "Seal the area"]
  };
  return <main className={`game-shell ${reducedMotion ? "reduced-motion" : ""} ${scareKind ? `scare-${scareKind}` : ""}`}>
    <header className="terminal-header"><div className="wordmark">DO NOT <b>SAY IT.</b></div><span className="case-id">CALL {String(state.callIndex).padStart(2, "0")} / {state.blueprint.caller.name}</span>{languagePicker}</header>
    <section className="game-grid">
      <section className="feed-column" aria-label={t("Room view", "कमरा")}>
        <div className="feed-frame" ref={feedRef}>
          <div className={`room-layer ${plain ? "is-hidden" : ""}`} aria-hidden={plain}><RoomView ref={roomRef} state={state} reducedMotion={reducedMotion} paused={plain} onTravelChange={handleTravel} onScareChange={setScareKind} /></div>
          {plain && <div className="plain-room"><h2>{t("Room map", "कमरे का नक्शा")}</h2>{STATIONS.map((station) => <p key={station.code}><b>{station.code}</b> {hi ? station.hindi : station.name}</p>)}<p>{t("Caller at", "कॉलर यहाँ है")}: {state.callerPosition}</p></div>}
          <div className="feed-meta"><span>● {t("LIVE FEED", "लाइव कैमरा")}</span><span>{traveling ? t("Moving carefully…", "धीरे चल रही हूँ…") : t("Signal stable", "सिग्नल स्थिर")}</span></div>
          <button className="reset-camera" onClick={() => roomRef.current?.resetCamera()}>{t("Reset", "रीसेट")}</button>
          {captions && <div className="caption-card" style={{ left: `${captionPosition.x}%`, top: `${captionPosition.y}%` }}>
            <button className="caption-handle" aria-label={t("Drag caption panel", "कथन पैनल खींचें")} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragRef.current = { x: e.clientX, y: e.clientY, left: captionPosition.x, top: captionPosition.y }; }} onPointerMove={moveCaption} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={(e) => { const delta = e.key === "ArrowLeft" ? { x: -2, y: 0 } : e.key === "ArrowRight" ? { x: 2, y: 0 } : e.key === "ArrowUp" ? { x: 0, y: -2 } : e.key === "ArrowDown" ? { x: 0, y: 2 } : null; if (delta) { e.preventDefault(); setCaptionPosition((p) => ({ x: Math.max(1, Math.min(30, p.x + delta.x)), y: Math.max(10, Math.min(68, p.y + delta.y)) })); } }}>{state.blueprint.caller.name}<span>⠿</span></button>
            <p aria-live="polite">{state.caption || t("Waiting for the caller.", "कॉलर का इंतज़ार।")}</p>
          </div>}
        </div>
        <div className="camera-deck">{[t("Overview", "पूरा कमरा"), t("Threshold", "लाल निशान"), t("Overhead", "ऊपर से"), t("Follow", "पीछा करें")].map((name, index) => <button key={index} aria-pressed={state.cameraIndex === index} onClick={() => commit({ ...stateRef.current, cameraIndex: index })}>0{index + 1}<span>{name}</span></button>)}</div>
      </section>
      <aside className="operator-console">
        <section className="hud-cluster"><div className="operator-head"><span>{t("Exposure", "खतरा")}</span><b>{state.danger}<small>/10</small></b></div><div className="danger-meter" role="meter" aria-label={t("Danger", "खतरा")} aria-valuemin={0} aria-valuemax={10} aria-valuenow={state.danger}><i style={{ width: `${state.danger * 10}%` }} /></div>
        <div className="objective-card"><h2>{t(state.blueprint.objective === "escape" ? "Get Mara out." : state.blueprint.objective === "restore_power" ? "Restore the station." : state.blueprint.objective === "identify_caller" ? "Who is on the line?" : "Contain the impostor.", state.blueprint.objective === "escape" ? "मारा को बाहर निकालें।" : state.blueprint.objective === "restore_power" ? "केंद्र चालू करें।" : state.blueprint.objective === "identify_caller" ? "कॉल पर कौन है?" : "हमशक्ल को रोकें।")}</h2>
          <ol className="objective-steps">{steps.map((step, index) => <li key={step} className={state.steps.includes(keys[index]) ? "done" : ""}><span>{state.steps.includes(keys[index]) ? "✓" : `0${index + 1}`}</span>{step}</li>)}</ol>
        </div></section>
        <section className="transmission"><div className="section-title"><span>COMMS</span><span className={`mic-status status-${voiceStatus}`}>{voiceStatus === "live" ? t("Listening", "सुन रही हूँ") : speaking ? t("Caller speaking", "कॉलर बोल रही है") : t("Push to talk", "दबाकर बोलें")}</span></div>
          <div className="transcript-line" aria-live="polite">{state.partialTranscript || state.lastTranscript || t("Say it carefully.", "सोचकर बोलें।")}</div>
          {extractConcepts(state.partialTranscript || command).length > 0 && <p className="word-warning">{t("Danger words detected:", "खतरनाक शब्द:")} {extractConcepts(state.partialTranscript || command).map((c) => hi ? CONCEPT_ALIASES[c.concept][1] : c.concept).join(" · ")}</p>}
          <div className="voice-controls">{!voice.isConnected ? <button onClick={() => void connectVoice()} disabled={voiceStatus === "connecting"}>{voiceStatus === "connecting" ? t("Connecting…", "जुड़ रहा है…") : t("Enable microphone", "माइक चालू करें")}</button> : <><button className={`talk-button ${voiceStatus === "live" ? "listening" : ""}`} disabled={busy} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pushToTalk(true); }} onPointerUp={() => pushToTalk(false)} onPointerCancel={() => { voice.mute(); setVoiceStatus("muted"); }} onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); pushToTalk(true); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); pushToTalk(false); } }}>{t("Hold to speak / V", "दबाकर बोलें / V")}</button><button className="mute-button" onClick={() => { voice.close(); setVoiceStatus("idle"); }}>{t("Disconnect mic", "माइक बंद करें")}</button></>}
            <form onSubmit={submit}><label className="sr-only" htmlFor="command">{t("Your instruction", "आपका निर्देश")}</label><input id="command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("Type an instruction…", "निर्देश लिखें…")} maxLength={240} disabled={busy} /><button className="send-button" disabled={busy || !command.trim()}>{t("Send", "भेजें")}</button></form>
            <p className="voice-detail" role="status">{state.phase === "resolving" ? t("Understanding your instruction…", "आपका निर्देश समझ रही हूँ…") : traveling ? t("Wait for the caller to reach the marker.", "कॉलर के निशान तक पहुँचने का इंतज़ार करें।") : voiceDetail}</p>
          </div>
        </section>
        <div className="secondary-tools"><details className="hint-panel"><summary>{t("Hint", "मदद")}</summary>{suggestions[state.blueprint.objective].map((text) => <button key={text} disabled={busy} onClick={() => setCommand(text)}>{text}</button>)}</details>
        <details className="lexicon"><summary>{t("Learned words", "सीखे शब्द")} <span>{state.vocabulary.length}</span></summary><div className="word-grid">{state.vocabulary.length ? state.vocabulary.map((c) => <span key={c.concept}>{hi ? CONCEPT_ALIASES[c.concept][1] : c.concept}</span>) : t("None", "कोई नहीं")}</div></details></div>
      </aside>
    </section>
    <details className="settings-drawer"><summary>{source === "gemma" || source === "self-hosted" ? "Gemma · " : ""}{t("Settings", "सेटिंग")}</summary><div><label><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />{t("Captions", "लिखित बात")}</label><label><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />{t("Reduced motion", "कम गति")}</label><label><input type="checkbox" checked={plain} disabled={traveling} onChange={(e) => { handleTravel(false); setPlain(e.target.checked); }} />{t("Plain view", "सरल दृश्य")}</label><label>{t("Volume", "आवाज़")}<input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label><button onClick={() => setCaptionPosition({ x: 2, y: 68 })}>{t("Reset captions", "कथन रीसेट")}</button></div></details>
    {state.phase === "briefing" && <div className="modal-scrim"><section className="briefing-panel" role="dialog" aria-modal="true" aria-labelledby="brief-title"><span className="eyebrow">{t("Incoming call", "नई कॉल")}</span><h2 id="brief-title">{state.blueprint.caller.name}</h2><p>{t("Guide with markers A–D. Avoid forbidden names.", "A–D निशानों से दिशा दें। खतरनाक नाम न बोलें।")}</p><button className="primary" autoFocus onClick={() => { const next = beginCall(stateRef.current); commit(next); void speak(next.caption); }}>{t("Answer call", "कॉल उठाएँ")} ↗</button></section></div>}
    {state.phase === "ended" && endingReady && <div className="modal-scrim"><section className="ending-panel" role="dialog" aria-modal="true" aria-labelledby="end-title"><span className="eyebrow">{state.outcome === "escaped" ? t("Signal secured", "सिग्नल सुरक्षित") : t("Signal lost", "सिग्नल खो गया")}</span><h2 id="end-title">{state.outcome === "escaped" ? t("Careful words. Safe signal.", "सही शब्द। सुरक्षित सिग्नल।") : state.outcome === "identity_stolen" ? t("You trusted the wrong caller.", "आपने गलत कॉलर पर भरोसा किया।") : t("It learned too much.", "इसने बहुत कुछ सीख लिया।")}</h2><p className="score-stamp">{state.score} <small>{t("shift points", "कुल अंक")}</small></p><div className="ending-actions"><button className="primary" autoFocus disabled={generating} onClick={() => void nextCall()}>{generating ? t("Preparing…", "तैयारी…") : t("Next call", "अगली कॉल")}</button><button disabled={generating} onClick={reset}>{t("New shift", "नई शिफ्ट")}</button></div></section></div>}
  </main>;
}
export default App;

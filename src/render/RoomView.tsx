import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GameState } from "../game/engine";
import { RoomRenderer } from "./RoomRenderer";
import { STATIONS } from "../../shared/rules";
import type { ScareKind } from "./scenePolicy";

export type RoomViewHandle = { captureFrame: () => string; resetCamera: () => void };

export const RoomView = forwardRef<RoomViewHandle, {
  state: GameState;
  reducedMotion: boolean;
  paused?: boolean;
  onTravelChange?: (moving: boolean) => void;
  onScareChange?: (kind: ScareKind | null) => void;
}>(function RoomView({ state, reducedMotion, paused = false, onTravelChange, onScareChange }, ref) {
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RoomRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let renderer: RoomRenderer;
    try {
      renderer = new RoomRenderer(canvasRef.current);
      renderer.onTravelChange = onTravelChange;
      renderer.onScareChange = onScareChange;
      rendererRef.current = renderer;
      delete canvasRef.current.dataset.webglError;
      setError("");
    } catch (error) {
      canvasRef.current.dataset.webglError = error instanceof Error ? error.message : "WebGL unavailable";
      setError("3D view unavailable. Typed commands and the route list still work.");
      console.warn("Surveillance renderer unavailable; text controls remain active:", error);
      return;
    }
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.onTravelChange = onTravelChange;
      rendererRef.current.onScareChange = onScareChange;
    }
  }, [onTravelChange, onScareChange]);

  useEffect(() => {
    rendererRef.current?.setPaused(paused);
    rendererRef.current?.setReducedMotion(reducedMotion);
    rendererRef.current?.update(state);
  }, [state, reducedMotion, paused]);

  useImperativeHandle(ref, () => ({
    captureFrame: () => rendererRef.current?.captureFrame() || "",
    resetCamera: () => rendererRef.current?.resetCamera()
  }), []);

  return <>
    <canvas ref={canvasRef} tabIndex={0} className="surveillance-canvas" width={960} height={540} aria-label={state.language === "hi" ? "निगरानी कैमरा। घुमाने के लिए खींचें, ज़ूम करने के लिए स्क्रॉल करें।" : "Surveillance room. Drag to orbit, scroll to zoom. Focus and use arrows to pan."} />
    <div className="world-anchors" aria-label="Object markers">{STATIONS.map((station) => <span key={station.code} data-anchor={station.code} title={state.language === "hi" ? station.hindi : station.name}>{station.code}</span>)}</div>
    <div className="crt-overlay" aria-hidden="true" />
    <div className="signal-flash" aria-hidden="true" />
    {error && <p className="renderer-error" role="status">{error}</p>}
  </>;
});


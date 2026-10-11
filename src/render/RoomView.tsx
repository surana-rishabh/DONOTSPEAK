import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GameState } from "../game/engine";
import { RoomRenderer } from "./RoomRenderer";

export type RoomViewHandle = { captureFrame: () => string };

export const RoomView = forwardRef<RoomViewHandle, {
  state: GameState;
  reducedMotion: boolean;
  onCallerMove?: (coords: [number, number, number], sector: GameState["callerPosition"]) => void;
}>(function RoomView({ state, reducedMotion, onCallerMove }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RoomRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let renderer: RoomRenderer;
    try {
      renderer = new RoomRenderer(canvasRef.current);
      renderer.onCallerMoved = onCallerMove;
      rendererRef.current = renderer;
    } catch (error) {
      canvasRef.current.dataset.webglError = error instanceof Error ? error.message : "WebGL unavailable";
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
      rendererRef.current.onCallerMoved = onCallerMove;
    }
  }, [onCallerMove]);

  useEffect(() => {
    rendererRef.current?.update(state);
    rendererRef.current?.setReducedMotion(reducedMotion);
  }, [state, reducedMotion]);

  useImperativeHandle(ref, () => ({
    captureFrame: () => rendererRef.current?.captureFrame() || ""
  }), []);

  return <canvas ref={canvasRef} className="surveillance-canvas" width={640} height={360} aria-label="Archive surveillance feed" />;
});


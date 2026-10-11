import { useEffect, useRef } from "react";

export function ShadowPortrait({ reducedMotion }: { reducedMotion: boolean }) {
  const portrait = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = portrait.current;
    if (!node || reducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const x = (event.clientX / window.innerWidth - 0.5) * 22;
      const y = (event.clientY / window.innerHeight - 0.5) * 16;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.setProperty("--portrait-x", `${x}px`);
        node.style.setProperty("--portrait-y", `${y}px`);
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      node.style.setProperty("--portrait-x", "0px"); node.style.setProperty("--portrait-y", "0px");
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    return () => {
      reset(); window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset); window.removeEventListener("blur", reset);
    };
  }, [reducedMotion]);
  return <div ref={portrait} className="shadow-portrait" aria-hidden="true">
    <img src="/images/silence-portrait.png" alt="" width="1024" height="1536" fetchPriority="high" decoding="async" />
  </div>;
}

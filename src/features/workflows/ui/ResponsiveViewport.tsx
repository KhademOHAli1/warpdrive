"use client";

import { useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef } from "react";

// Keep the camera when labels or panels change language. A substantial width change
// needs a new fit so a desktop pan position cannot leave a narrow canvas empty.
export type RevealNode = { id: string; nonce: number };
export function ResponsiveViewport({ reveal }: { reveal?: RevealNode }) {
  const width = useStore((state) => state.width);
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  const previousWidth = useRef<number | null>(null);
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || reveal === undefined || revealed.current === reveal.nonce) return;
    revealed.current = reveal.nonce;
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    void fitView({
      nodes: [{ id: reveal.id }],
      padding: 0.6,
      minZoom: 0.8,
      maxZoom: 1,
      duration: reduced ? 0 : 180,
    });
  }, [ready, reveal, fitView]);
  useEffect(() => {
    if (!ready || width <= 0) return;
    if (previousWidth.current === null) {
      previousWidth.current = width;
      return;
    }
    if (Math.abs(width - previousWidth.current) <= 48) return;
    previousWidth.current = width;
    void fitView({ padding: 0.2, minZoom: 0.7, maxZoom: 1.1 });
  }, [width, ready, fitView]);
  return null;
}

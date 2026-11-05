"use client";

import { useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef } from "react";

// Keep the camera when labels or panels change language. A substantial width change
// needs a new fit so a desktop pan position cannot leave a narrow canvas empty.
export type RevealNode = { id: string; nonce: number };
export function ResponsiveViewport({ reveal }: { reveal?: RevealNode }) {
  const width = useStore((state) => state.width);
  const ready = useNodesInitialized();
  const { fitView, getNodes, getNodesBounds, getViewport, setViewport } = useReactFlow();
  const previousWidth = useRef<number | null>(null);
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || width <= 0) return;
    if (previousWidth.current === null) {
      const nodes = getNodes();
      if (nodes.length === 0) return;
      previousWidth.current = width;
      if (reveal?.nonce === 0) revealed.current = 0;
      const current = getViewport();
      // Do not replace a pan/zoom the viewer made while node measurements were settling.
      if (current.x !== 0 || current.y !== 150 || current.zoom !== 1) return;
      const bounds = getNodesBounds(nodes);
      void setViewport(
        { x: width / 2 - bounds.width / 2 - bounds.x, y: 150, zoom: 1 },
        { duration: 0 },
      );
      return;
    }
    if (Math.abs(width - previousWidth.current) <= 48) return;
    previousWidth.current = width;
    void fitView({ padding: 0.2, minZoom: 0.7, maxZoom: 1.1 });
  }, [width, ready, reveal, fitView, getNodes, getNodesBounds, getViewport, setViewport]);
  useEffect(() => {
    if (
      !ready ||
      previousWidth.current === null ||
      reveal === undefined ||
      revealed.current === reveal.nonce
    )
      return;
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
  return null;
}

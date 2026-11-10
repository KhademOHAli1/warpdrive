"use client";

import { useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef } from "react";

// A side panel changes the width, not the viewer's zoom or vertical pan.
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
    const widthChange = width - previousWidth.current;
    if (widthChange === 0) return;
    previousWidth.current = width;
    const current = getViewport();
    void setViewport({ ...current, x: current.x + widthChange / 2 }, { duration: 0 });
  }, [width, ready, reveal, getNodes, getNodesBounds, getViewport, setViewport]);
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

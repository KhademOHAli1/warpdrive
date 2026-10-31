"use client";

import { useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef } from "react";

// Keep the camera when labels or panels change language. A substantial width change
// needs a new fit so a desktop pan position cannot leave a narrow canvas empty.
export function ResponsiveViewport() {
  const width = useStore((state) => state.width);
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  const previousWidth = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || width <= 0) return;
    if (previousWidth.current === null) {
      previousWidth.current = width;
      return;
    }
    if (Math.abs(width - previousWidth.current) <= 48) return;
    previousWidth.current = width;
    void fitView({ padding: 0.2, maxZoom: 1.1 });
  }, [width, ready, fitView]);
  return null;
}

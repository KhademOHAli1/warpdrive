"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

// Inbox stacks and earlier-message sections retain hidden content for drafts/animation.
// aria-hidden alone is intentionally ignored: an open Radix dialog applies it to the background.
export function useDeliveryObservationVisibility(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const update = () => setVisible(node.isConnected && node.closest("[hidden],[inert]") === null);
    const observer = new MutationObserver(update);
    for (
      let ancestor: HTMLElement | null = node;
      ancestor !== null;
      ancestor = ancestor.parentElement
    )
      observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden", "inert"] });
    update();
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

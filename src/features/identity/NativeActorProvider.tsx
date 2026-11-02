"use client";
import { createContext, type ReactNode, useContext, useLayoutEffect, useRef } from "react";

// Public account identity established by the authenticated server layout, never authority.
const NativeActor = createContext<string | null>(null);
export function NativeActorProvider({
  actorId,
  children,
}: {
  actorId: string;
  children: ReactNode;
}): ReactNode {
  return <NativeActor.Provider value={actorId}>{children}</NativeActor.Provider>;
}
export function useNativeActor() {
  const actorId = useContext(NativeActor);
  const active = useRef<string | null>(null);
  useLayoutEffect(() => {
    active.current = actorId;
    return () => {
      active.current = null;
    };
  }, [actorId]);
  // The authenticated layout keys this provider by actor ID. Its synchronous unmount
  // cleanup fences late callbacks before another account's client subtree is mounted.
  return { actorId, isCurrent: () => actorId !== null && active.current === actorId };
}

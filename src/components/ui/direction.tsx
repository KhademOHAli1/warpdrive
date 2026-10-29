"use client";
import type { ReactNode } from "react";
import { DirectionProvider as ShadcnDirectionProvider } from "./primitives/direction";

export { useDirection } from "./primitives/direction";

export function DirectionProvider({
  children,
  direction,
  dir = "ltr",
}: {
  children: ReactNode;
  direction?: "ltr" | "rtl";
  dir?: "ltr" | "rtl";
}): ReactNode {
  return <ShadcnDirectionProvider dir={direction ?? dir}>{children}</ShadcnDirectionProvider>;
}

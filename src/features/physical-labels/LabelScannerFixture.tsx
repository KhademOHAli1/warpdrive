"use client";

import { useHydrated } from "@/lib/useHydrated";
import type { ScanInput } from "./contracts";
import { resolveLabelFixture } from "./fixtureState";
import { LabelScanner } from "./ui/LabelScanner";

export function LabelScannerFixture({
  actorId,
  canManage,
  initialCode,
}: {
  actorId: string;
  canManage: boolean;
  initialCode?: string;
}) {
  const hydrated = useHydrated();
  function resolve(input: ScanInput) {
    return Promise.resolve(resolveLabelFixture(actorId, canManage, window.location.origin, input));
  }
  return hydrated ? (
    <LabelScanner initialCode={initialCode} resolve={resolve} registryVisible fixture />
  ) : null;
}

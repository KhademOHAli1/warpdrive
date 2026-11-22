"use client";

import { scanTagFromLabelFixture } from "@/features/assets/tags/fixtureScans";
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
    const origin = window.location.origin;
    return Promise.resolve(
      scanTagFromLabelFixture(actorId, canManage, origin, input) ??
        resolveLabelFixture(actorId, canManage, origin, input),
    );
  }
  return hydrated ? (
    <LabelScanner initialCode={initialCode} resolve={resolve} registryVisible fixture />
  ) : null;
}

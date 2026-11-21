"use client";

import { readCsrfToken } from "@/utils/csrfCookie";
import type { AssetsWorkspace } from "../contracts";
import { executeAssetAction } from "../webActions";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsLive({
  initial,
  actorId,
  initialAssetId,
}: {
  initial: AssetsWorkspace;
  actorId: string;
  initialAssetId: string | null;
}) {
  return (
    <AssetsRegister
      initial={initial}
      initialAssetId={initialAssetId}
      submit={(command) => executeAssetAction(actorId, command, readCsrfToken())}
      fixture={false}
    />
  );
}

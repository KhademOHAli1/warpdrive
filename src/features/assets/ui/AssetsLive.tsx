"use client";

import { readCsrfToken } from "@/utils/csrfCookie";
import type { AssetsWorkspace } from "../contracts";
import { executeAssetAction } from "../webActions";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsLive({ initial, actorId }: { initial: AssetsWorkspace; actorId: string }) {
  return (
    <AssetsRegister
      initial={initial}
      submit={(command) => executeAssetAction(actorId, command, readCsrfToken())}
      fixture={false}
    />
  );
}

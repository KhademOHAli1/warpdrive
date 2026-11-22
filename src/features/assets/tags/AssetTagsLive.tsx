"use client";

import { useCallback } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import type {
  AssetTagContactInput,
  AssetTagScanInput,
  AssetTagWorkspace as Workspace,
} from "./contracts";
import { AssetTagLanding } from "./ui/AssetTagLanding";
import { AssetTagWorkspace } from "./ui/AssetTagWorkspace";
import {
  executeAssetTagAction,
  resolveAssetTagAction,
  sendAssetTagContactAction,
} from "./webActions";

const unavailable = { ok: false, error: "unavailable" } as const;

export function AssetTagsLive({ actorId, initial }: { actorId: string; initial: Workspace }) {
  return (
    <AssetTagWorkspace
      initial={initial}
      submit={(input) => executeAssetTagAction(actorId, input, readCsrfToken())}
      fixture={false}
    />
  );
}

export function AssetTagLandingLive({
  actorId,
  token,
  signInHref,
  proof,
}: {
  actorId: string | null;
  token: string;
  signInHref: string;
  proof: string | null;
}) {
  const resolve = useCallback(
    (input: AssetTagScanInput) =>
      actorId === null
        ? Promise.resolve(unavailable)
        : resolveAssetTagAction(actorId, input, readCsrfToken()),
    [actorId],
  );
  return (
    <AssetTagLanding
      token={token}
      signedIn={actorId !== null}
      signInHref={signInHref}
      contactAvailable={proof !== null}
      resolve={actorId === null ? undefined : resolve}
      sendMessage={
        proof === null
          ? undefined
          : (input: AssetTagContactInput) => sendAssetTagContactAction(input, proof)
      }
    />
  );
}

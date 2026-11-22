"use client";

import { readCsrfToken } from "@/utils/csrfCookie";
import type { AssetsWorkspace } from "../contracts";
import { executeCustodyAction } from "../custody/webActions";
import { executeKitAction } from "../kits/webActions";
import { executeAssetAction } from "../webActions";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsLive({
  initial,
  actorId,
  initialAssetId,
  initialKitId,
  bookingsAvailable,
  physicalLabelsAvailable,
  assetTagsAvailable,
}: {
  initial: AssetsWorkspace;
  actorId: string;
  initialAssetId: string | null;
  initialKitId: string | null;
  bookingsAvailable: boolean;
  physicalLabelsAvailable: boolean;
  assetTagsAvailable?: boolean;
}) {
  return (
    <AssetsRegister
      initial={initial}
      initialAssetId={initialAssetId}
      initialKitId={initialKitId}
      bookingsAvailable={bookingsAvailable}
      physicalLabelsAvailable={physicalLabelsAvailable}
      assetTagsAvailable={assetTagsAvailable}
      submit={(command) => executeAssetAction(actorId, command, readCsrfToken())}
      submitCustody={
        initial.custody === undefined
          ? undefined
          : (command) => executeCustodyAction(actorId, command, readCsrfToken())
      }
      submitKit={
        initial.kits === undefined
          ? undefined
          : (command) => executeKitAction(actorId, command, readCsrfToken())
      }
      fixture={false}
    />
  );
}

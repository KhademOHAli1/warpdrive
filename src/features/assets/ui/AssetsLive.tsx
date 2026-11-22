"use client";

import { useMemo } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { AssetsWorkspace } from "../contracts";
import { executeCustodyAction } from "../custody/webActions";
import type { AssetRegisterDiscoveryAccess } from "../discovery/contracts";
import {
  readAssetRegisterViewsAction,
  removeAssetRegisterViewAction,
  runAssetRegisterBatchAction,
  saveAssetRegisterViewAction,
} from "../discovery/webActions";
import { executeKitAction } from "../kits/webActions";
import type { AssetMediaAccess } from "../media/contracts";
import { readAssetMediaAction, selectAssetMediaCoverAction } from "../media/webActions";
import { uploadAssetMedia } from "../media/webUpload";
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
  auditsAvailable,
}: {
  initial: AssetsWorkspace;
  actorId: string;
  initialAssetId: string | null;
  initialKitId: string | null;
  bookingsAvailable: boolean;
  physicalLabelsAvailable: boolean;
  assetTagsAvailable?: boolean;
  auditsAvailable?: boolean;
}) {
  const mediaAccess = useMemo<AssetMediaAccess>(
    () => ({
      read: (target) => readAssetMediaAction(actorId, target, readCsrfToken()),
      upload: (input) => uploadAssetMedia(actorId, input),
      setCover: (input) => selectAssetMediaCoverAction(actorId, input, readCsrfToken()),
    }),
    [actorId],
  );
  const discoveryAccess = useMemo<AssetRegisterDiscoveryAccess>(
    () => ({
      readViews: () => readAssetRegisterViewsAction(actorId, readCsrfToken()),
      saveView: (input) => saveAssetRegisterViewAction(actorId, input, readCsrfToken()),
      removeView: (input) => removeAssetRegisterViewAction(actorId, input, readCsrfToken()),
      batch: (input) => runAssetRegisterBatchAction(actorId, input, readCsrfToken()),
    }),
    [actorId],
  );
  return (
    <AssetsRegister
      initial={initial}
      initialAssetId={initialAssetId}
      initialKitId={initialKitId}
      bookingsAvailable={bookingsAvailable}
      physicalLabelsAvailable={physicalLabelsAvailable}
      assetTagsAvailable={assetTagsAvailable}
      auditsAvailable={auditsAvailable}
      mediaAccess={initial.mediaAvailable === true ? mediaAccess : undefined}
      discoveryAccess={initial.discoveryAvailable === true ? discoveryAccess : undefined}
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

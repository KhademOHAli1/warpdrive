"use client";

import { useEffect, useRef, useState } from "react";
import type { AssetCommand, AssetResult, AssetsWorkspace } from "../contracts";
import {
  type CustodyCommand,
  type CustodyResult,
  emptyCustodyWorkspace,
} from "../custody/contracts";
import { applyCustodyCommand } from "../custody/transitions";
import { assetsFixture } from "../fixtures";
import { emptyKitWorkspace, type KitCommand, type KitResult } from "../kits/contracts";
import { applyKitCommand } from "../kits/transitions";
import { createAssetMediaFixture } from "../media/fixture";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsFixture({
  canManage,
  initialAssetId,
}: {
  canManage: boolean;
  initialAssetId?: string | null;
}) {
  const [initial] = useState<AssetsWorkspace>(() => ({
    ...assetsFixture(canManage),
    kits: emptyKitWorkspace(),
    custody: {
      ...emptyCustodyWorkspace(),
      staff: canManage
        ? [
            { id: "693fde54-eb03-424f-86e5-40e576c95991", name: "Ada Schneider" },
            { id: "1e829425-a1cf-4267-81fd-e592772936e8", name: "Leon Becker" },
          ]
        : [],
    },
  }));
  const current = useRef(initial);
  const [media] = useState(() => createAssetMediaFixture(initial));
  useEffect(() => () => media.dispose(), [media]);
  const kitReceipts = useRef(new Map<string, { signature: string; kitId: string }>());
  const receipts = useRef(
    new Map<
      string,
      { signature: string; outcomes: Extract<CustodyResult, { ok: true }>["outcomes"] }
    >(),
  );

  function submit(command: AssetCommand): Promise<AssetResult> {
    const result = applyAssetWorkspaceCommand(current.current, command, "Demo operator");
    if (result.ok) {
      current.current = result.value;
      media.updateRegister(result.value);
    }
    return Promise.resolve(result);
  }

  function submitCustody(command: CustodyCommand): Promise<CustodyResult> {
    const signature = JSON.stringify(command);
    const saved = receipts.current.get(command.requestId);
    if (saved !== undefined && current.current.custody !== undefined) {
      return Promise.resolve(
        saved.signature === signature
          ? {
              ok: true,
              value: { ...current.current, custody: current.current.custody },
              outcomes: saved.outcomes,
            }
          : { ok: false, error: "conflict" },
      );
    }
    const result = applyCustodyCommand(current.current, command, "Demo operator");
    if (result.ok) {
      current.current = result.value;
      receipts.current.set(command.requestId, { signature, outcomes: result.outcomes });
    }
    return Promise.resolve(result);
  }

  function submitKit(command: KitCommand): Promise<KitResult> {
    const signature = JSON.stringify(command);
    const saved = kitReceipts.current.get(command.requestId);
    const kits = current.current.kits;
    if (saved !== undefined && kits !== undefined) {
      return Promise.resolve(
        saved.signature === signature
          ? { ok: true, value: { ...current.current, kits }, kitId: saved.kitId }
          : { ok: false, error: "conflict" },
      );
    }
    const result = applyKitCommand(current.current, command, "Demo operator");
    if (result.ok) {
      current.current = result.value;
      kitReceipts.current.set(command.requestId, { signature, kitId: result.kitId });
    }
    return Promise.resolve(result);
  }

  return (
    <AssetsRegister
      initial={initial}
      initialAssetId={initialAssetId}
      submit={submit}
      submitCustody={submitCustody}
      submitKit={submitKit}
      mediaAccess={media.access}
      fixture
    />
  );
}

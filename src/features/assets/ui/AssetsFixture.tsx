"use client";

import { useRef, useState } from "react";
import type { AssetCommand, AssetResult } from "../contracts";
import { assetsFixture } from "../fixtures";
import { applyAssetWorkspaceCommand } from "../registerCommands";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsFixture({ canManage }: { canManage: boolean }) {
  const [initial] = useState(() => assetsFixture(canManage));
  const current = useRef(initial);

  function submit(command: AssetCommand): Promise<AssetResult> {
    const result = applyAssetWorkspaceCommand(current.current, command, "Demo operator");
    if (result.ok) current.current = result.value;
    return Promise.resolve(result);
  }

  return <AssetsRegister initial={initial} submit={submit} fixture />;
}

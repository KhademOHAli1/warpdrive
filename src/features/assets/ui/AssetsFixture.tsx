"use client";

import { useRef, useState } from "react";
import type { AssetCommand, AssetResult } from "../contracts";
import { applyAssetFixtureCommand } from "../fixtureCommands";
import { assetsFixture } from "../fixtures";
import { AssetsRegister } from "./AssetsWorkspace";

export function AssetsFixture({ canManage }: { canManage: boolean }) {
  const [initial] = useState(() => assetsFixture(canManage));
  const current = useRef(initial);

  function submit(command: AssetCommand): Promise<AssetResult> {
    const result = applyAssetFixtureCommand(current.current, command);
    if (result.ok) current.current = result.value;
    return Promise.resolve(result);
  }

  return <AssetsRegister initial={initial} submit={submit} fixture />;
}

"use client";

import { useRef } from "react";
import type { InventoryCommand, InventoryWorkspace } from "./contracts";
import { applyInventoryFixture } from "./fixtures";
import { InventoryClient } from "./ui/InventoryClient";

export function InventoryFixture({ initial }: { initial: InventoryWorkspace }) {
  const workspace = useRef(initial);
  async function submit(command: InventoryCommand) {
    const result = applyInventoryFixture(workspace.current, command);
    if (result.ok) workspace.current = result.value;
    return result;
  }

  return <InventoryClient initial={initial} submit={submit} />;
}

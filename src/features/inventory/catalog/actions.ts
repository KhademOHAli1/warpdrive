"use server";

import { invokeAction } from "@/frontend/actions";
import type { CatalogCommand, CatalogResult } from "./contracts";

export async function executeCatalogAction(
  actorId: string,
  command: CatalogCommand,
  csrf: string | null,
): Promise<CatalogResult> {
  return invokeAction("features/inventory/catalog/actions.executeCatalogAction", [
    actorId,
    command,
    csrf,
  ]);
}

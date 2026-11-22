import { env } from "@/config/env";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { LabelResult, ScanResult } from "./contracts";
import { resolveLabel, runLabelCommand } from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;

async function labelSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function executePhysicalLabelAction(
  expectedActorId: string,
  input: unknown,
  csrf: string | null,
): Promise<LabelResult> {
  const current = await labelSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : runLabelCommand(current.db, current.session, input, AbortSignal.timeout(20_000));
}

export async function resolvePhysicalLabelAction(
  expectedActorId: string,
  input: unknown,
  csrf: string | null,
): Promise<ScanResult> {
  const current = await labelSession(expectedActorId, csrf);
  return current === null
    ? unavailable
    : resolveLabel(
        current.db,
        current.session,
        input,
        new URL(env.BASE_URL).origin,
        AbortSignal.timeout(15_000),
      );
}

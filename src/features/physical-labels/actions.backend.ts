import { env } from "@/config/env";
import { resolveAssetTagFromLabelScan } from "@/features/assets/tags/service";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { type LabelResult, type ScanResult, scanInput } from "./contracts";
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
  if (current === null) return unavailable;
  const parsed = scanInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const origin = new URL(env.BASE_URL).origin;
  const signal = AbortSignal.timeout(15_000);
  const { db, session } = current;
  const tag = await resolveAssetTagFromLabelScan(db, session, parsed.data, origin, signal);
  return tag ?? resolveLabel(db, session, parsed.data, origin, signal);
}

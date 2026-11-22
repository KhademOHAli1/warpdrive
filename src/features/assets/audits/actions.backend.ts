import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { EquipmentAuditLookup, EquipmentAuditRead, EquipmentAuditWrite } from "./contracts";
import { auditUnavailable } from "./scope";
import { lookupEquipmentAudit, readEquipmentAudit, runEquipmentAudit } from "./service";

async function currentSession(expectedActorId: string, csrf: string | null) {
  if (!(await guardCsrf(csrf)).ok) return null;
  const { actor, db, session } = await createContext();
  return actor?.id === expectedActorId && session !== null ? { db, session } : null;
}

export async function readEquipmentAuditAction(
  expectedActorId: string,
  auditId: unknown,
  csrf: string | null,
): Promise<EquipmentAuditRead> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? auditUnavailable
    : readEquipmentAudit(current.db, current.session, auditId, AbortSignal.timeout(15_000));
}

export async function executeEquipmentAuditAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<EquipmentAuditWrite> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? auditUnavailable
    : runEquipmentAudit(current.db, current.session, command, AbortSignal.timeout(20_000));
}

export async function lookupEquipmentAuditAction(
  expectedActorId: string,
  auditId: unknown,
  code: unknown,
  csrf: string | null,
): Promise<EquipmentAuditLookup> {
  const current = await currentSession(expectedActorId, csrf);
  return current === null
    ? auditUnavailable
    : lookupEquipmentAudit(current.db, current.session, auditId, code, AbortSignal.timeout(15_000));
}

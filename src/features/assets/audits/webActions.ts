"use server";

import { invokeAction } from "@/frontend/actions";
import type {
  EquipmentAuditCommand,
  EquipmentAuditLookup,
  EquipmentAuditRead,
  EquipmentAuditWrite,
} from "./contracts";

export async function readEquipmentAuditAction(
  actorId: string,
  auditId: string,
  csrf: string | null,
): Promise<EquipmentAuditRead> {
  return invokeAction("features/assets/audits/webActions.readEquipmentAuditAction", [
    actorId,
    auditId,
    csrf,
  ]);
}

export async function executeEquipmentAuditAction(
  actorId: string,
  command: EquipmentAuditCommand,
  csrf: string | null,
): Promise<EquipmentAuditWrite> {
  return invokeAction("features/assets/audits/webActions.executeEquipmentAuditAction", [
    actorId,
    command,
    csrf,
  ]);
}

export async function lookupEquipmentAuditAction(
  actorId: string,
  auditId: string,
  code: string,
  csrf: string | null,
): Promise<EquipmentAuditLookup> {
  return invokeAction("features/assets/audits/webActions.lookupEquipmentAuditAction", [
    actorId,
    auditId,
    code,
    csrf,
  ]);
}

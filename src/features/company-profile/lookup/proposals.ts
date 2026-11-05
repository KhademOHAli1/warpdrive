import { z } from "zod";
import { err, ok } from "@/types/result";
import { openCompany, sealCompany } from "../crypto";
import { companyFailure } from "../policy";
import { type Candidate, candidateSchema } from "./contracts";

const proof = candidateSchema.extend({ expiresAt: z.number().finite() });
export function signProposal(
  candidate: Candidate,
  actorId: string,
  workspaceScope: string,
  now = Date.now(),
): string {
  return sealCompany(
    { ...candidate, expiresAt: now + 15 * 60000 },
    `lookup:${actorId}:${workspaceScope}`,
  );
}
export function readProposal(
  token: string,
  actorId: string,
  workspaceScope: string,
  now = Date.now(),
  allowExpiredReplay = false,
) {
  try {
    const data = openCompany(token, `lookup:${actorId}:${workspaceScope}`, proof);
    if (!allowExpiredReplay && data.expiresAt < now) return err(companyFailure("conflict"));
    return ok({
      lei: data.lei,
      data: data.data,
      checkedAt: data.checkedAt,
      sourceUrl: data.sourceUrl,
    });
  } catch {
    return err(companyFailure("invalid_input"));
  }
}

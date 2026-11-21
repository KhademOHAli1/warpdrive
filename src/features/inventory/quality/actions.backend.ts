import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import { type QualityCommandResult, qualityCommand } from "./contracts";
import { confirmQualityEvidence, requestQualityEvidence } from "./evidence";
import { QualityFailure } from "./failure";
import { recordQualityRun } from "./runs";

export async function executeInventoryQualityAction(
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<QualityCommandResult> {
  if (!(await guardCsrf(csrf)).ok) return err("unavailable");
  const { actor, db, session } = await createContext();
  if (actor?.id !== expectedActorId || session === null) return err("unavailable");
  const command = qualityCommand.safeParse(raw);
  if (!command.success) return err("invalid");
  const signal = AbortSignal.timeout(20_000);
  try {
    switch (command.data.type) {
      case "requestEvidence":
        return await requestQualityEvidence(db, session, command.data, signal);
      case "confirmEvidence":
        return await confirmQualityEvidence(db, session, command.data, signal);
      case "recordRun":
        return await recordQualityRun(db, session, command.data, signal);
    }
  } catch (error) {
    if (error instanceof QualityFailure) return err(error.code);
    throw error;
  }
}

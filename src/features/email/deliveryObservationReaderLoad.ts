import { err, ok, type Result } from "@/types/result";
import type { DeliveryObservationReaderScope } from "./deliveryObservationReader.types";
import {
  listDeliveryObservationReviewTargets,
  readDeliveryObservationReports,
} from "./deliveryObservationTransport.client";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";

export async function loadDeliveryObservationReader(
  scope: DeliveryObservationReaderScope,
  signal: AbortSignal,
): Promise<
  Result<
    { reports: DeliveryObservationView[]; targets: DeliveryReviewTarget[] },
    DeliveryObservationError
  >
> {
  const selector =
    scope.reference.kind === "source"
      ? { sourceMessageId: scope.reference.sourceMessageId }
      : { attemptId: scope.reference.attemptId };
  const reports = await readDeliveryObservationReports(
    { accountId: scope.accountId, ...selector },
    signal,
  );
  signal.throwIfAborted();
  if (!reports.ok) return reports;
  const choices = await Promise.all(
    reports.value.map((report) =>
      listDeliveryObservationReviewTargets(
        { accountId: scope.accountId, reportId: report.id },
        signal,
      ),
    ),
  );
  signal.throwIfAborted();
  const targets = new Map<string, DeliveryReviewTarget>();
  for (const result of choices) {
    if (!result.ok) return result;
    for (const target of result.value) {
      const previous = targets.get(target.attemptId);
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(target))
        return err("conflict");
      targets.set(target.attemptId, target);
    }
  }
  return ok({ reports: reports.value, targets: [...targets.values()] });
}

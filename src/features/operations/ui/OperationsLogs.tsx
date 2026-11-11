"use client";
import { useCallback, useId, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { trpc } from "@/lib/trpc-client";
import {
  OperationsMetric as Metric,
  OperationsCode,
  OperationsPager,
  OperationsReadNotice,
  operationsReason,
  useOperationsFormat,
  useOperationsLabels,
} from "./OperationsShared";
import { createOperationsReadSlot, readOperationsPair } from "./readCycle";
import type { HistoryCursor } from "./types";
import { useOperationsRead } from "./useOperationsRead";
import { useOperationsCursor } from "./viewState";

const readSlot = createOperationsReadSlot();
export function OperationsLogs() {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  const client = trpc.useUtils().client;
  const [openOnly, setOpenOnly] = useState(true);
  const filterId = useId();
  const incidents = useOperationsCursor<HistoryCursor>();
  const events = useOperationsCursor<HistoryCursor>();
  const read = useCallback(
    async (signal: AbortSignal, denied: () => void) => {
      const [history, receipts] = await readOperationsPair(
        () => client.operations.incidents.query({ openOnly, cursor: incidents.cursor }, { signal }),
        () => client.operations.events.query({ cursor: events.cursor }, { signal }),
        denied,
      );
      return { history, receipts };
    },
    [client, openOnly, incidents.cursor, events.cursor],
  );
  const result = useOperationsRead(
    JSON.stringify([openOnly, incidents.cursor, events.cursor]),
    read,
    readSlot,
  );
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L.logsTitle}
        description={L.logsInfo}
        actions={
          <Button variant="outline" size="sm" disabled={result.busy} onClick={result.refresh}>
            {L.refresh}
          </Button>
        }
      />
      <SettingsCardBody className="space-y-6">
        <OperationsReadNotice
          denied={result.denied}
          failure={result.failure}
          busy={result.busy}
          empty={result.data === undefined}
        />
        {!result.denied && (
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id={filterId}
                checked={openOnly}
                disabled={result.busy}
                onCheckedChange={(value) => {
                  setOpenOnly(value);
                  incidents.first();
                }}
                label={L.openOnly}
              />
              <label htmlFor={filterId} className="text-sm">
                {L.openOnly}
              </label>
            </div>
            {result.data !== undefined && (
              <>
                <section aria-label={L.incidentsTitle} className="space-y-3">
                  <h3 className="text-sm font-semibold">{L.incidentsTitle}</h3>
                  {result.data.history.items.length === 0 ? (
                    <EmptyState title={L.emptyIncidents} body={L.emptyIncidentsInfo} />
                  ) : (
                    <div className="divide-y">
                      {result.data.history.items.slice(0, 30).map((incident) => (
                        <article key={incident.id} className="space-y-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <OperationsCode>{incident.observationKey}</OperationsCode>
                            <Badge variant="outline">
                              {incident.recoveredAt === null ? L.open : L.recovered}
                            </Badge>
                          </div>
                          <p className="text-sm">
                            {L.state[incident.state]} · {operationsReason(incident.reason, L)}
                          </p>
                          <dl className="grid gap-3 text-sm sm:grid-cols-3">
                            <Metric label={L.incident}>
                              <OperationsCode>{incident.id}</OperationsCode>
                            </Metric>
                            <Metric label={L.source}>
                              <OperationsCode>{incident.sourceId}</OperationsCode>
                            </Metric>
                            <Metric label={L.revision}>{format.number(incident.revision)}</Metric>
                            <Metric label={L.openedAt}>{format.date(incident.openedAt)}</Metric>
                            <Metric label={L.updatedAt}>{format.date(incident.updatedAt)}</Metric>
                            <Metric label={L.recoveredAt}>
                              {format.date(incident.recoveredAt)}
                            </Metric>
                          </dl>
                        </article>
                      ))}
                    </div>
                  )}
                  <OperationsPager
                    pager={incidents}
                    next={result.data.history.nextCursor}
                    busy={result.busy}
                  />
                </section>
                <section aria-label={L.eventsTitle} className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">{L.eventsTitle}</h3>
                  {result.data.receipts.items.length === 0 ? (
                    <EmptyState title={L.emptyEvents} body={L.emptyEventsInfo} />
                  ) : (
                    <div className="divide-y">
                      {result.data.receipts.items.slice(0, 30).map((receipt) => (
                        <article key={receipt.receiptId} className="py-3">
                          <dl className="grid gap-3 text-sm sm:grid-cols-3">
                            <Metric label={L.receipt}>
                              <OperationsCode>{receipt.receiptId}</OperationsCode>
                            </Metric>
                            <Metric label={L.source}>
                              <OperationsCode>{receipt.sourceId}</OperationsCode>
                            </Metric>
                            <Metric label={L.generation}>
                              <OperationsCode>{receipt.generationId}</OperationsCode>
                            </Metric>
                            <Metric label={L.sequence}>{format.number(receipt.sequence)}</Metric>
                            <Metric label={L.observationCount}>
                              {format.number(receipt.observationCount)}
                            </Metric>
                            <Metric label={L.reportedAt}>{format.date(receipt.observedAt)}</Metric>
                            <Metric label={L.receivedAt}>{format.date(receipt.receivedAt)}</Metric>
                            <Metric label={L.payloadFingerprint}>
                              <OperationsCode>{receipt.payloadSha256}</OperationsCode>
                            </Metric>
                          </dl>
                        </article>
                      ))}
                    </div>
                  )}
                  <OperationsPager
                    pager={events}
                    next={result.data.receipts.nextCursor}
                    busy={result.busy}
                  />
                </section>
              </>
            )}
          </>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}

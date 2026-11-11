"use client";
import { useCallback } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { trpc } from "@/lib/trpc-client";
import { ObservationDetails, observationTarget } from "./ObservationDetails";
import {
  OperationsMetric as Metric,
  OperationsCode,
  OperationsPager,
  OperationsReadNotice,
  operationsReason,
  operationsSourceLabel,
  useOperationsFormat,
  useOperationsLabels,
} from "./OperationsShared";
import { createOperationsReadSlot, readOperationsPair } from "./readCycle";
import type { CurrentCursor, ObservationRow } from "./types";
import { useOperationsRead } from "./useOperationsRead";
import { operationsVisibleState, useOperationsCursor } from "./viewState";

const readSlot = createOperationsReadSlot();

function ObservationItem({
  row,
  checkedAt,
  startedAt,
  now,
  unavailable,
}: {
  row: ObservationRow;
  checkedAt: string;
  startedAt: number;
  now: number;
  unavailable: boolean;
}) {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  const state = operationsVisibleState(row, checkedAt, startedAt, now, unavailable);
  const reason = state === "stale" ? "observation_stale" : row.reason;
  return (
    <article className="space-y-2 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {row.observation === null ? (
            <OperationsCode>{row.observationKey}</OperationsCode>
          ) : (
            <>
              {L.kinds[row.observation.kind]} · {observationTarget(row.observation, L)}
            </>
          )}
        </h3>
        <Badge
          variant={
            state === "healthy" ? "success" : state === "failed" ? "destructive" : "secondary"
          }
        >
          {L.state[state]}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {operationsReason(unavailable ? "unavailable" : reason, L)} ·{" "}
        {unavailable ? L.unknownValue : operationsSourceLabel(row.sourceState, L)}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <Metric label={L.source}>
          <OperationsCode>{row.sourceId}</OperationsCode>
        </Metric>
        <Metric label={L.reportedAt}>{format.date(row.observedAt)}</Metric>
        <Metric label={L.receivedAt}>{format.date(row.receivedAt)}</Metric>
      </dl>
      {row.observation !== null && <ObservationDetails observation={row.observation} />}
    </article>
  );
}

export function OperationsMaintenance() {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  const client = trpc.useUtils().client;
  const observations = useOperationsCursor<CurrentCursor>();
  const sources = useOperationsCursor<string>();
  const read = useCallback(
    async (signal: AbortSignal, denied: () => void) => {
      const [current, enrollment] = await readOperationsPair(
        () => client.operations.observations.query({ cursor: observations.cursor }, { signal }),
        () => client.operations.sources.query({ cursor: sources.cursor }, { signal }),
        denied,
      );
      return { current, enrollment };
    },
    [client, observations.cursor, sources.cursor],
  );
  const result = useOperationsRead(
    JSON.stringify([observations.cursor, sources.cursor]),
    read,
    readSlot,
  );
  const data = result.data;
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L.maintenanceTitle}
        description={L.maintenanceInfo}
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
          empty={data === undefined}
        />
        {!result.denied && data !== undefined && (
          <>
            <section aria-label={L.observationsTitle} className="space-y-3">
              <h3 className="text-sm font-semibold">{L.observationsTitle}</h3>
              <p className="text-xs text-muted-foreground">
                {L.checkedAt}: {format.date(data.current.checkedAt)}
              </p>
              {data.current.items.length === 0 ? (
                <EmptyState title={L.emptyObservations} body={L.emptyObservationsInfo} />
              ) : (
                <div className="divide-y">
                  {data.current.items.slice(0, 30).map((row) => (
                    <ObservationItem
                      key={`${row.sourceId}:${row.observationKey}`}
                      row={row}
                      checkedAt={data.current.checkedAt}
                      startedAt={result.startedAt}
                      now={result.now}
                      unavailable={result.failure !== null}
                    />
                  ))}
                </div>
              )}
              <OperationsPager
                pager={observations}
                next={data.current.nextCursor}
                busy={result.busy}
              />
            </section>
            <section aria-label={L.sourcesTitle} className="space-y-3 border-t pt-5">
              <h3 className="text-sm font-semibold">{L.sourcesTitle}</h3>
              <p className="text-sm text-muted-foreground">{L.sourcesInfo}</p>
              {result.failure !== null ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {L.unknownValue}
                </p>
              ) : data.enrollment.items.length === 0 ? (
                <EmptyState title={L.emptySources} body={L.emptySourcesInfo} />
              ) : (
                <div className="divide-y">
                  {data.enrollment.items.slice(0, 30).map((source) => (
                    <article key={source.sourceId} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-medium">{L.roles[source.role]}</h4>
                        <Badge variant="outline">
                          {source.active ? L.enrollmentActive : L.enrollmentInactive}
                        </Badge>
                      </div>
                      <p className="text-sm">
                        {source.admissionState === "storage_pressure"
                          ? L.sourceState.storage_pressure
                          : L.admissionReady}
                      </p>
                      <dl className="grid gap-3 text-sm sm:grid-cols-3">
                        <Metric label={L.source}>
                          <OperationsCode>{source.sourceId}</OperationsCode>
                        </Metric>
                        <Metric label={L.generation}>
                          <OperationsCode>{source.generationId}</OperationsCode>
                        </Metric>
                        <Metric label={L.highestSequence}>
                          {format.number(source.highestSequence)}
                        </Metric>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
              <OperationsPager
                pager={sources}
                next={data.enrollment.nextCursor}
                busy={result.busy}
              />
            </section>
          </>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}

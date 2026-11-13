"use client";
import {
  OperationsMetric as Metric,
  OperationsCode,
  type OperationsLabels,
  useOperationsFormat,
  useOperationsLabels,
} from "./OperationsShared";
import type { Observation } from "./types";

export function observationTarget(value: Observation, L: OperationsLabels): string {
  switch (value.kind) {
    case "component":
    case "heartbeat":
    case "deployment":
      return L.components[value.component];
    case "feature":
      return L.features[value.feature];
    case "provider":
      return L.providers[value.provider];
    case "queue":
      return value.queue;
    case "observer":
      return L.observers[value.observer];
    case "recovery":
      return L.recoveryStages[value.stage];
  }
}

function DeploymentDetails({
  observation,
}: {
  observation: Extract<Observation, { kind: "deployment" }>;
}) {
  const L = useOperationsLabels();
  return (
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
      <Metric label={L.deploymentOutcome}>{L.deploymentOutcomes[observation.outcome]}</Metric>
      <Metric label={L.sourceRevision}>
        {observation.sourceRevision === null ? (
          L.unknownValue
        ) : (
          <OperationsCode>{observation.sourceRevision}</OperationsCode>
        )}
      </Metric>
      <Metric label={L.proofHash}>
        {observation.proofSha256 === null ? (
          L.unknownValue
        ) : (
          <OperationsCode>{observation.proofSha256}</OperationsCode>
        )}
      </Metric>
    </dl>
  );
}

function HeartbeatDetails({
  observation,
}: {
  observation: Extract<Observation, { kind: "heartbeat" }>;
}) {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  return (
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
      <Metric label={L.generation}>
        {observation.processGeneration === null ? (
          L.unknownValue
        ) : (
          <OperationsCode>{observation.processGeneration}</OperationsCode>
        )}
      </Metric>
      <Metric label={L.uptime}>{format.seconds(observation.uptimeMs)}</Metric>
      <Metric label={L.activeCallbacks}>{format.number(observation.activeCallbacks)}</Metric>
      {observation.sampledAtMs !== undefined && (
        <Metric label={L.sampledAt}>{format.date(observation.sampledAtMs)}</Metric>
      )}
    </dl>
  );
}

export function ObservationDetails({ observation }: { observation: Observation }) {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  switch (observation.kind) {
    case "component": {
      const identity = observation.installed;
      if (identity.evidence === "unchecked")
        return <p className="mt-2 text-sm text-muted-foreground">{L.identityUnchecked}</p>;
      return (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">{L.reportedIdentity}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Metric label={L.imageDigest}>
              <OperationsCode>{identity.imageDigest}</OperationsCode>
            </Metric>
            <Metric label={L.sourceRevision}>
              <OperationsCode>{identity.sourceRevision}</OperationsCode>
            </Metric>
            <Metric label={L.configurationHash}>
              <OperationsCode>{identity.configurationSha256}</OperationsCode>
            </Metric>
            <Metric label={L.schemaHash}>
              {identity.schemaSha256 === null ? (
                L.unknownValue
              ) : (
                <OperationsCode>{identity.schemaSha256}</OperationsCode>
              )}
            </Metric>
          </dl>
        </div>
      );
    }
    case "heartbeat":
      return <HeartbeatDetails observation={observation} />;
    case "deployment":
      return <DeploymentDetails observation={observation} />;
    case "queue":
      return (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Metric label={L.pendingCount}>{format.number(observation.pendingCount)}</Metric>
          <Metric label={L.activeCount}>{format.number(observation.activeCount)}</Metric>
          <Metric label={L.readyOldestAge}>{format.seconds(observation.readyOldestAgeMs)}</Metric>
          <Metric label={L.lastProgressAt}>{format.date(observation.lastProgressAtMs)}</Metric>
          <Metric label={L.sampledAt}>{format.date(observation.sampledAtMs)}</Metric>
        </dl>
      );
    case "recovery":
      return (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Metric label={L.recoverySet}>
            {observation.recoverySetId === null ? (
              L.unknownValue
            ) : (
              <OperationsCode>{observation.recoverySetId}</OperationsCode>
            )}
          </Metric>
          <Metric label={L.completedAt}>{format.date(observation.completedAtMs)}</Metric>
          <Metric label={L.duration}>{format.seconds(observation.durationMs)}</Metric>
          <Metric label={L.bytes}>{format.number(observation.bytes)}</Metric>
          <Metric label={L.encrypted}>
            {observation.encrypted === null ? L.unknownValue : observation.encrypted ? L.yes : L.no}
          </Metric>
          <Metric label={L.contentHash}>
            {observation.contentSha256 === null ? (
              L.unknownValue
            ) : (
              <OperationsCode>{observation.contentSha256}</OperationsCode>
            )}
          </Metric>
        </dl>
      );
    case "feature":
    case "provider":
    case "observer":
      return null;
  }
}

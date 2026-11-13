import type { Queue, QueueResult } from "pg-boss";

// Fixed infrastructure, independent of workspace/account count. The update-check queue is
// harmless when disabled; only the Worker decides whether to register its handler/schedule.
export const QUEUE_NAMES = Object.freeze([
  "email.sync",
  "email.send.process",
  "email.recovery",
  "file.reaper",
  "import.prepare",
  "import.validate",
  "import.commit",
  "import.undo",
  "notification.email",
  "activity.reminder",
  "activity.reminder.native.v1",
  "activity.reminder.reconcile.v1",
  "calendar.reminder",
  "activity.reminder.dispatch",
  "auth-maintenance",
  "release.check",
  "workflow.run",
  "workflow.reconcile",
  "workflow.schedule",
  "workflow-v2-run",
  "workflow-v2-reconcile",
  "newsletter-operations-monitor",
  "__pgboss__send-it",
] as const);

export type QueueName = (typeof QUEUE_NAMES)[number];

// Read-coverage inventory for the supported partitioned PostgreSQL schema46 shape in
// pg-boss12.38.2. Its drift checker skips some empty/unreadable catalog dimensions.
// Keep this independent of those best-effort checks; a package/schema upgrade must
// deliberately reconcile this inventory before a new binary can admit runtime.
const JOB_COLUMNS =
  "blocked blocking completed_on created_on data dead_letter deletion_seconds expire_seconds group_id group_tier heartbeat_on heartbeat_seconds id keep_until name output pending_dependencies policy priority retry_backoff retry_count retry_delay retry_delay_max retry_limit singleton_key singleton_on source_created_on source_id source_name source_output source_retry_count source_root_id start_after started_on state trace_context upsert_by_key".split(
    " ",
  );

export const QUEUE_CATALOG_TABLES = Object.freeze({
  bam: {
    columns:
      "command completed_on created_on error id name queue started_on status table_name version".split(
        " ",
      ),
    constraints: 1,
  },
  instance: {
    columns:
      "application_name config crash_restarts crash_restarts_since heartbeat_on heartbeat_seconds host id metrics migrate name node_version persist_queue_stats persist_warnings pid pool_idle pool_max pool_total pool_waiting schedule started_on stopped_on supervise version workers".split(
        " ",
      ),
    constraints: 1,
  },
  job: { columns: JOB_COLUMNS, constraints: 1 },
  job_common: { columns: JOB_COLUMNS, constraints: 4 },
  job_dependency: {
    columns: "child_id child_name parent_id parent_name".split(" "),
    constraints: 1,
  },
  queue: {
    columns:
      "active_count blocked_count completed_delta created_delta created_on dead_letter deferred_count deletion_seconds delta_on delta_seconds expire_seconds failed_count failed_delta heartbeat_seconds maintain_on monitor_claim_on monitor_on name notify partition policy queued_count ready_count ready_history ready_oldest_seconds retained_count retained_on retention_seconds retry_backoff retry_delay retry_delay_max retry_limit run_bins singletons_active table_name total_count updated_on wait_bins warning_queued".split(
        " ",
      ),
    constraints: 3,
  },
  queue_stats: {
    columns:
      "active_count captured_on completed_delta created_delta deferred_count delta_on delta_seconds failed_count failed_delta id name queued_count ready_count ready_oldest_seconds run_bins total_count wait_bins".split(
        " ",
      ),
    constraints: 1,
  },
  schedule: {
    columns: "created_on cron data key kind last_job_id name options timezone updated_on".split(
      " ",
    ),
    constraints: 3,
  },
  subscription: { columns: "created_on event name updated_on".split(" "), constraints: 2 },
  version: {
    columns: "bam_on cron_on flow_on monitor_backoff_on reindex_on version".split(" "),
    constraints: 1,
  },
  warning: { columns: "created_on data id message type".split(" "), constraints: 1 },
});

export const QUEUE_CATALOG_FUNCTIONS = Object.freeze({
  create_queue: { arguments: "text, jsonb", returns: "void", language: "plpgsql", volatility: "v" },
  delete_queue: { arguments: "text", returns: "void", language: "plpgsql", volatility: "v" },
  job_now: { arguments: "", returns: "timestamp with time zone", language: "sql", volatility: "s" },
  job_table_format: { arguments: "text, text", returns: "text", language: "sql", volatility: "i" },
  job_table_run: {
    arguments: "text, text, text",
    returns: "void",
    language: "plpgsql",
    volatility: "v",
  },
  job_table_run_async: {
    arguments: "text, integer, text, text, text",
    returns: "void",
    language: "plpgsql",
    volatility: "v",
  },
});

export const QUEUE_CATALOG_ENUM = Object.freeze([
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
]);

// pg-boss 12.38.2/schema46 defaults. Per-message retry, expiry, startAfter and
// singleton options remain owned by producers; do not turn these into queue policies.
export const QUEUE_OPTIONS = Object.freeze({
  policy: "standard",
  partition: false,
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
  expireInSeconds: 900,
  retentionSeconds: 1_209_600,
  deleteAfterSeconds: 604_800,
  warningQueueSize: 0,
  notify: false,
} satisfies Omit<Queue, "name">);

const PERSISTED_QUEUE_OPTIONS = Object.freeze({
  ...QUEUE_OPTIONS,
  retryDelayMax: null,
  heartbeatSeconds: null,
  deadLetter: null,
  table: "job_common",
});

export function isManifestQueue(name: string): name is QueueName {
  return QUEUE_NAMES.some((queue) => queue === name);
}

/** Existing queue options are checked, never silently reconciled by createQueue. */
export function queueMatchesManifest(queue: QueueResult | null): boolean {
  return (
    queue !== null &&
    isManifestQueue(queue.name) &&
    Object.entries(PERSISTED_QUEUE_OPTIONS).every(
      ([key, expected]) => queue[key as keyof QueueResult] === expected,
    )
  );
}

export function queueOptionsMatchManifest(options: Omit<Queue, "name"> = {}): boolean {
  const entries: [string, unknown][] = Object.entries(options);
  return entries.every(
    ([key, value]) =>
      value === undefined ||
      (key in QUEUE_OPTIONS && QUEUE_OPTIONS[key as keyof typeof QUEUE_OPTIONS] === value),
  );
}

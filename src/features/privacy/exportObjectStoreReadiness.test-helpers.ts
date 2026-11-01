import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { StartedTestContainer } from "testcontainers";

type RingLabel = "ring_master_broadcast" | "ring_filer_applying" | "ring_s3_received";
type RingEvent = {
  label: RingLabel;
  version: string;
  memberCount: number;
  expectedMemberMatches: boolean;
};
type Membership = {
  filerCount: number;
  expectedMemberMatches: boolean;
  groupMatches: boolean;
  configRead: boolean;
  version?: "4.50";
  revisionMatchesPinned: boolean;
};
type ProbeKind = "ok" | "failed" | "exec_failed" | "unsupported" | "timeout" | "invalid";

// The piped command is read-only; timeout bounds Background-context RPCs too.
// Only the fixed synthetic local cluster is addressed, with no data-plane warm-up.
const MEMBERSHIP_COMMAND = [
  "/bin/sh",
  "-c",
  "printf 'cluster.ps\\n' | /bin/busybox timeout -s KILL 2s /usr/bin/weed -logtostderr=true shell -debug=true -master=127.0.0.1:9333 -filer=127.0.0.1:8888 -filerGroup= -connectTimeout=1s",
];
const RING_EVENTS: readonly [RegExp, RingLabel][] = [
  [
    /^I\d{4} \d{2}:\d{2}:\d{2}\.\d{6} lock_ring_manager\.go:\d+ LockRing: broadcasting ring update for group "" version (\d+): \[([^\r\n]*)\]$/u,
    "ring_master_broadcast",
  ],
  [
    /^I\d{4} \d{2}:\d{2}:\d{2}\.\d{6} filer\.go:\d+ LockRing: applying master ring update v(\d+): \[([^\r\n]*)\]$/u,
    "ring_filer_applying",
  ],
  [
    /^I\d{4} \d{2}:\d{2}:\d{2}\.\d{6} masterclient\.go:\d+ LockRing: s3@127\.0\.0\.1:\d+ received ring update v(\d+): \[([^\r\n]*)\]$/u,
    "ring_s3_received",
  ],
];

function membershipFromOutput(output: string): Membership | undefined {
  if (output.length > 32_768) return undefined;
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\* filers \d+$/u.test(line));
  if (start < 0) return undefined;
  const count = Number(lines[start]?.slice("* filers ".length));
  if (!Number.isSafeInteger(count) || count < 0 || count > 8) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^\* /u.test(line));
  const section = lines.slice(start + 1, end < 0 ? undefined : end);
  const rows = section.filter((line) => /^\s+\* /u.test(line));
  const expected =
    rows.length === 1
      ? /^\s+\* 127\.0\.0\.1:8888\.18888 \(([^)\r\n]{1,128})\) /u.exec(rows[0] ?? "")
      : null;
  const version = expected?.[1] ?? "";
  const revision = /(?:^|\s)([a-f0-9]{7,40})(?:\s|$)/u.exec(version)?.[1];
  return {
    filerCount: count,
    expectedMemberMatches: count === 1 && expected !== null,
    groupMatches: !section.some((line) => /^\s+filer group:/u.test(line)),
    configRead: section.some((line) => /^\s+signature: -?\d+$/u.test(line)),
    version: /(?:^|\s)4\.50(?:\s|$)/u.test(version) ? "4.50" : undefined,
    revisionMatchesPinned:
      revision !== undefined && "ec8f9793502c59ce3381cc4151bfc0806afd92e8".startsWith(revision),
  };
}

function membershipReady(membership: Membership | undefined): boolean {
  return (
    membership?.expectedMemberMatches === true &&
    membership.groupMatches &&
    membership.configRead &&
    membership.version === "4.50" &&
    membership.revisionMatchesPinned
  );
}

// SeaweedFS uses UnixNano int64 versions, which must not pass through Number rounding.
function positiveInt64Version(value: string | undefined): string | undefined {
  return value !== undefined &&
    /^[1-9]\d{0,18}$/u.test(value) &&
    (value.length < 19 || value <= "9223372036854775807")
    ? value
    : undefined;
}

async function boundedMembershipProbe(container: StartedTestContainer, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort = () => {};
  const interrupted = new Promise<{ kind: "timeout" }>((resolve) => {
    onAbort = () => resolve({ kind: "timeout" });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // The in-container timeout terminates weed; fixture cleanup owns a failed Docker exec.
  const pending = container.exec(MEMBERSHIP_COMMAND).then(
    (result) => ({ kind: "completed" as const, result }),
    () => ({ kind: "exec_failed" as const }),
  );
  try {
    return await Promise.race([pending, interrupted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createSeaweedReadiness() {
  const ring = new Map<RingLabel, RingEvent>();
  let state: "pending" | "ready" | "failed" = "pending";
  let polls = 0;
  let probeKind: ProbeKind | undefined;
  let membership: Membership | undefined;
  const snapshot = () => ({
    state,
    polls,
    probeKind,
    membership: membership === undefined ? undefined : { ...membership },
    ring: [...ring.values()].map((event) => ({ ...event })),
  });
  const consumeProbe = (probe: Awaited<ReturnType<typeof boundedMembershipProbe>>): ProbeKind => {
    if (probe.kind !== "completed") return probe.kind;
    if (probe.result.exitCode === 126 || probe.result.exitCode === 127) return "unsupported";
    if (probe.result.exitCode !== 0) return "failed";
    membership = membershipFromOutput(probe.result.stdout);
    return membership === undefined ? "invalid" : "ok";
  };
  const observeLine = (line: string): RingEvent | undefined => {
    for (const [pattern, label] of RING_EVENTS) {
      const match = pattern.exec(line);
      if (match === null) continue;
      const version = positiveInt64Version(match[1]);
      if (version === undefined) return undefined;
      const members = (match[2] ?? "").split(/\s+/u).filter(Boolean);
      if (members.length > 8) return undefined;
      const expectedMember =
        label === "ring_filer_applying" ? "127.0.0.1:8888" : "127.0.0.1:8888.18888";
      const event = {
        label,
        version,
        memberCount: members.length,
        expectedMemberMatches: members.length === 1 && members[0] === expectedMember,
      };
      ring.set(label, event);
      return event;
    }
    return undefined;
  };
  const ringReady = () => {
    const events = [...ring.values()];
    return (
      events.length === 3 &&
      events.every(
        (event) =>
          event.version === events[0]?.version &&
          event.memberCount === 1 &&
          event.expectedMemberMatches,
      )
    );
  };
  const wait = async (
    container: StartedTestContainer,
    startupDeadlineMs: number,
    signal: AbortSignal,
  ) => {
    try {
      signal.throwIfAborted();
      while (performance.now() < startupDeadlineMs) {
        signal.throwIfAborted();
        const remaining = startupDeadlineMs - performance.now();
        const bounded = AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, Math.min(2500, Math.floor(remaining)))),
        ]);
        polls++;
        const probe = await boundedMembershipProbe(container, bounded);
        signal.throwIfAborted();
        probeKind = consumeProbe(probe);
        if (probeKind !== "ok") break;
        if (membershipReady(membership) && ringReady()) {
          state = "ready";
          return snapshot();
        }
        const pause = Math.min(500, startupDeadlineMs - performance.now());
        if (pause > 0) await delay(pause, undefined, { signal });
      }
    } finally {
      if (state !== "ready") state = "failed";
    }
    return snapshot();
  };
  return { observeLine, snapshot, wait };
}

import type {
  ExportIntakeAccess,
  ExportIntakeBinding,
  ExportIntakeIssueCode,
  ExportIntakeJob,
  ExportIntakeResult,
  ExportManifest,
} from "./contracts";
import { validateExportBundle } from "./manifest";

type FixtureOptions = {
  getTargetState: (target: ExportIntakeBinding) => "draft" | "approved" | null;
  failFirstReady?: boolean;
  now?: () => string;
  makeId?: () => string;
};

function failure(code: ExportIntakeIssueCode): {
  ok: false;
  issues: { code: ExportIntakeIssueCode }[];
} {
  return { ok: false, issues: [{ code }] };
}

function result<T>(value: T): ExportIntakeResult<T> {
  return { ok: true, value: structuredClone(value) };
}

function bindingKey({ itemId, releaseId, sku, revision }: ExportIntakeBinding): string {
  return JSON.stringify([itemId, releaseId, sku, revision]);
}

function packageFingerprint(target: ExportIntakeBinding, manifest: ExportManifest): string {
  const files = [...manifest.files].sort((left, right) => {
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
  return JSON.stringify([bindingKey(target), { ...manifest, files }]);
}

export function createExportIntakeFixture({
  getTargetState,
  failFirstReady = false,
  now = () => new Date().toISOString(),
  makeId = () => crypto.randomUUID(),
}: FixtureOptions): ExportIntakeAccess {
  const jobs = new Map<string, ExportIntakeJob>();
  const submittedPackages = new Map<string, string>();
  const requests = new Map<string, { fingerprint: string; jobId: string }>();
  let seedTemporaryFailure = failFirstReady;

  function draftIssue(target: ExportIntakeBinding): ExportIntakeIssueCode | null {
    const state = getTargetState(target);
    if (state === "draft") return null;
    return state === "approved" ? "draftChanged" : "unavailable";
  }

  function resolveRequest(requestId: string, fingerprint: string) {
    const prior = requests.get(requestId);
    if (prior === undefined) return null;
    const job = jobs.get(prior.jobId);
    if (job === undefined || prior.fingerprint !== fingerprint) return failure("conflict");
    return result(job);
  }

  function applyAttempt(job: ExportIntakeJob, failed: boolean, at: string): ExportIntakeJob {
    const id = makeId();
    const outcome = failed ? "failed" : "ready";
    return {
      ...job,
      state: outcome,
      attempts: [
        ...job.attempts,
        { id, at, outcome, issue: failed ? { code: "temporary" } : null },
      ],
      artifacts: failed
        ? []
        : job.manifest.files.map(({ kind, name, sha256 }) => ({
            id: makeId(),
            kind,
            name,
            sha256,
          })),
      failedAttemptId: failed ? id : null,
    };
  }

  return {
    list(target, signal) {
      if (signal?.aborted === true) {
        return Promise.reject(
          new DOMException("The export list request was aborted.", "AbortError"),
        );
      }
      if (getTargetState(target) === null) return Promise.resolve(failure("unavailable"));
      const key = bindingKey(target);
      return Promise.resolve(
        result([...jobs.values()].filter((job) => bindingKey(job.target) === key).reverse()),
      );
    },

    async submit(input) {
      const { itemId, releaseId, sku, revision } = input.target;
      const target = { itemId, releaseId, sku, revision };
      const { requestId, manifest } = input;
      const issue = draftIssue(target);
      if (issue !== null) return failure(issue);
      const validated = await validateExportBundle(manifest, input.files, target);
      if (!validated.ok) return validated;
      const currentIssue = draftIssue(target);
      if (currentIssue !== null) return failure(currentIssue);

      const packageKey = packageFingerprint(target, validated.value);
      const fingerprint = JSON.stringify(["submit", packageKey]);
      const replay = resolveRequest(requestId, fingerprint);
      if (replay !== null) return replay;
      const existingId = submittedPackages.get(packageKey);
      const existing = existingId === undefined ? undefined : jobs.get(existingId);
      if (existing !== undefined) {
        requests.set(requestId, { fingerprint, jobId: existing.id });
        return result(existing);
      }

      const submittedAt = now();
      const job = applyAttempt(
        {
          id: makeId(),
          submittedAt,
          target,
          manifest: validated.value,
          state: "queued",
          attempts: [],
          artifacts: [],
          failedAttemptId: null,
        },
        seedTemporaryFailure,
        submittedAt,
      );
      seedTemporaryFailure = false;
      jobs.set(job.id, job);
      submittedPackages.set(packageKey, job.id);
      requests.set(requestId, { fingerprint, jobId: job.id });
      return result(job);
    },

    retry({ target, requestId, jobId, failedAttemptId }) {
      const issue = draftIssue(target);
      if (issue !== null) return Promise.resolve(failure(issue));
      const key = bindingKey(target);
      const job = jobs.get(jobId);
      if (job === undefined || bindingKey(job.target) !== key) {
        return Promise.resolve(failure("unavailable"));
      }
      const fingerprint = JSON.stringify(["retry", key, jobId, failedAttemptId]);
      const replay = resolveRequest(requestId, fingerprint);
      if (replay !== null) return Promise.resolve(replay);
      if (job.state !== "failed" || job.failedAttemptId !== failedAttemptId) {
        return Promise.resolve(failure("conflict"));
      }

      const ready = applyAttempt(job, false, now());
      jobs.set(jobId, ready);
      requests.set(requestId, { fingerprint, jobId });
      return Promise.resolve(result(ready));
    },
  };
}

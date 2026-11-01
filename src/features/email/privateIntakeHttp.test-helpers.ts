import { setTimeout as delay } from "node:timers/promises";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { connectNotificationMailbox } from "@/features/notifications/email/notificationJob.test-helpers";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import {
  privateReviewMutableSnapshot,
  privateReviewProtectedSnapshot,
} from "./privateIntakeReview.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

async function seedPrivateIntakeHttp(db: Db) {
  const signal = AbortSignal.timeout(30_000);
  const stale = new Date(Date.now() - 3_600_000);
  const owner = await seedMailHttpSession(db, {
    assurance: "mfa",
    twoFactorEnabled: true,
    freshAt: stale,
    mfaAt: stale,
  });
  const account = await connectNotificationMailbox(db, owner.user.id, signal);
  const intake = await seedPrivateIntake(db, signal, { accountId: account.id });
  const scope = { accountId: account.id, intakeId: intake.id };
  const input = { ...scope, expectedRevision: 0, decision: "keep_private" as const };
  const summary: PrivateIntakeSummary = {
    id: intake.id,
    revision: 0,
    state: "unverified",
    contentState: "retained",
    decision: null,
  };
  return {
    db,
    signal,
    owner,
    account,
    intake,
    scope,
    input,
    summary,
    get(headers = owner.headers, query = new URLSearchParams(scope).toString()) {
      return new Request(`${owner.origin}/api/email/private-intake?${query}`, { headers });
    },
    post(body: unknown = input, headers = owner.headers) {
      return new Request(`${owner.origin}/api/email/private-intake`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    },
    async snapshot() {
      return {
        mutable: await privateReviewMutableSnapshot(db, intake.id, signal),
        protected: await privateReviewProtectedSnapshot(db, account.id, signal),
      };
    },
  };
}

export async function withPrivateIntakeHttp(
  run: (f: Awaited<ReturnType<typeof seedPrivateIntakeHttp>>) => Promise<void>,
): Promise<void> {
  await withTestDb(async (db) => run(await seedPrivateIntakeHttp(db)));
}

export async function seedForeignPrivateHttpOwner(db: Db, signal: AbortSignal, isAdmin: boolean) {
  const stranger = await seedMailHttpSession(db, {
    isAdmin,
    assurance: isAdmin ? "mfa" : "password",
    twoFactorEnabled: isAdmin,
    mfaAt: new Date(Date.now() - 3_600_000),
  });
  await connectNotificationMailbox(db, stranger.user.id, signal);
  return stranger;
}

export function invalidPrivateIntakeQueries(scope: { accountId: string; intakeId: string }) {
  const valid = new URLSearchParams(scope).toString();
  return [
    "",
    `accountId=${scope.accountId}`,
    `intakeId=${scope.intakeId}`,
    `accountId=not-a-guid&intakeId=${scope.intakeId}`,
    `${valid}&accountId=${scope.accountId}`,
    `${valid}&intakeId=${scope.intakeId}`,
    `${valid}&attemptId=${scope.intakeId}`,
  ];
}

export function invalidPrivateIntakeBodies(input: {
  accountId: string;
  intakeId: string;
  expectedRevision: number;
  decision: string;
}) {
  return [
    null,
    [],
    { intakeId: input.intakeId, expectedRevision: 0, decision: input.decision },
    { ...input, accountId: "not-a-guid" },
    { ...input, intakeId: "not-a-guid" },
    { ...input, expectedRevision: -1 },
    { ...input, expectedRevision: 0.5 },
    { ...input, expectedRevision: 2_147_483_647 },
    { ...input, expectedRevision: Number.MAX_SAFE_INTEGER },
    { ...input, expectedRevision: "0" },
    { ...input, decision: "associate" },
    { ...input, confirmationAttemptId: input.intakeId },
  ];
}

export function oversizedPrivateHttpRequest(base: Request) {
  const headers = new Headers(base.headers);
  headers.set("content-length", "1");
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: "ف".repeat(20_000) })));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body,
    duplex: "half",
  };
  return { request: new Request(base.url, init), wasCancelled: () => cancelled };
}

// Bound fixture waits and remove their timers even when the expected dependency never starts.
export async function boundedPrivateHttp<T>(work: Promise<T>, timeoutMs = 1000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function privateHttpDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function observePrivateHttpRejections(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const observe = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", observe);
  try {
    await run();
    await delay(0);
    return unhandled;
  } finally {
    process.off("unhandledRejection", observe);
  }
}

import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailAccounts } from "@/db/schema";
import type { sendGmail } from "@/features/email/sendSystem";
import { runEmailNotificationJob } from "./email/job";
import { notificationJobTransport } from "./email/notificationJob.test-helpers";

export type SendFn = typeof sendGmail;

// Preserve the calendar policy assertions while exercising today's durable mail
// worker. The callback observes the synthetic provider boundary, never database results.
export async function runCalendarNotificationJob(
  db: Db,
  data: { notificationId: string },
  signal: AbortSignal,
  observation: { send: SendFn },
) {
  const fixture = notificationJobTransport();
  const original = fixture.gmail.sendRaw.bind(fixture.gmail);
  let accountId: string | null = null;
  const send = vi.spyOn(fixture.gmail, "sendRaw").mockImplementation(async (input) => {
    if (accountId === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Calendar mail fixture account missing");
    const [account] = await db
      .select({
        id: emailAccounts.id,
        userId: emailAccounts.userId,
        emailAddress: emailAccounts.emailAddress,
      })
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId));
    if (account === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Calendar mail fixture account missing");
    const parsed = await simpleParser(Buffer.from(input.rawBase64, "base64url"));
    input.signal.throwIfAborted();
    const groups =
      parsed.to === undefined ? [] : Array.isArray(parsed.to) ? parsed.to : [parsed.to];
    const result = await observation.send(
      account,
      {
        to: groups.flatMap((group) =>
          group.value.flatMap((entry) => (entry.address === undefined ? [] : [entry.address])),
        ),
        subject: parsed.subject ?? "",
        bodyHtml: typeof parsed.html === "string" ? parsed.html : "",
        bodyText: parsed.text,
      },
      input.signal,
    );
    return result.ok ? original(input) : result;
  });
  try {
    return await runEmailNotificationJob(db, data, signal, {
      ...fixture.deps,
      resolveClient: (id, nextSignal) => {
        accountId = id;
        nextSignal.throwIfAborted();
        return fixture.deps.resolveClient();
      },
    });
  } finally {
    send.mockRestore();
  }
}

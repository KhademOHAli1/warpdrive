import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import { MAIL_PROTOCOL_TEST_CERT } from "@/test/mailProtocolTls";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { checkMailboxConnection } from "./mailConnectionCheck";
import { commitMailboxProof } from "./mailConnectionCommit";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { resolveMailboxTransports } from "./mailConnectionTransport";
import { hydrateOwner } from "./syncCursor";

export const softSignal = () => AbortSignal.timeout(30_000);

async function closeProtocols(
  imap: Awaited<ReturnType<typeof startMailProtocolImap>>,
  smtp?: Awaited<ReturnType<typeof startMailProtocolSmtp>>,
) {
  const results = await Promise.allSettled([imap.close(), ...(smtp ? [smtp.close()] : [])]);
  const failures = results.flatMap((result): unknown[] => {
    if (result.status !== "rejected") return [];
    const reason: unknown = result.reason;
    return [reason];
  });
  if (failures.length) throw new AggregateError(failures, "Soft lifecycle protocol cleanup failed");
}

// Real loopback TLS protocols, native proof and canonical commit. No account/save-success stub.
export async function openSoftMailbox(db: Db) {
  const imap = await startMailProtocolImap();
  let smtp: Awaited<ReturnType<typeof startMailProtocolSmtp>> | undefined;
  try {
    smtp = await startMailProtocolSmtp();
    imap.state.folders.set("Trash", {
      validity: "789",
      readOnly: false,
      messages: [],
      specialUse: "\\Trash",
    });
    const native = await seedMailHttpSession(db, { email: "soft-owner@example.test" });
    const endpoint = (port: number) => ({
      host: "127.0.0.1",
      port,
      security: "tls" as const,
      username: "owner@mail.test",
      password: "synthetic-password",
    });
    const input = {
      emailAddress: "owner@mail.test",
      displayName: "Soft lifecycle owner",
      imap: endpoint(imap.endpoint.port),
      smtp: endpoint(smtp.endpoint.port),
    };
    const policy = {
      internalEndpoints: [
        {
          protocol: "imaps" as const,
          host: "127.0.0.1",
          port: imap.endpoint.port,
          allowLoopback: true,
          ca: MAIL_PROTOCOL_TEST_CERT,
        },
        {
          protocol: "smtps" as const,
          host: "127.0.0.1",
          port: smtp.endpoint.port,
          allowLoopback: true,
          ca: MAIL_PROTOCOL_TEST_CERT,
        },
      ],
    };
    let enqueues = 0;
    const enqueueSync = () => {
      enqueues += 1;
      return Promise.resolve(true);
    };
    const checked = await checkMailboxConnection(db, native.context, input, softSignal(), {
      policy,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok)
      throw new AppError(ERROR_IDS.DB_INVARIANT, `Initial protocol check failed: ${checked.error}`);
    const saved = await commitMailboxProof(
      db,
      native.context,
      { checkId: checked.value.checkId, folderPaths: ["INBOX"], historyDays: 90, isDefault: true },
      softSignal(),
      { enqueueSync },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok)
      throw new AppError(ERROR_IDS.DB_INVARIANT, `Initial native commit failed: ${saved.error}`);
    expect(enqueues).toBe(1);
    const transports = await resolveMailboxTransports(input, softSignal(), policy);
    if (!transports.ok)
      throw new AppError(ERROR_IDS.DB_INVARIANT, `Fixture transports failed: ${transports.error}`);
    const hydrated = await hydrateOwner(db, native.user.id, softSignal());
    if (!hydrated.ok) throw hydrated.error;
    const runtime: ImapConnectionRuntime = {
      accountId: saved.value.id,
      ownerId: native.user.id,
      generation: 1,
      emailAddress: input.emailAddress,
      historyDays: 90,
      folderPaths: ["INBOX"],
      imap: transports.value.imap,
      smtp: transports.value.smtp,
    };
    let runtimeLoads = 0;
    const deps = {
      loadConnection: () => {
        runtimeLoads += 1;
        return Promise.resolve(ok(runtime));
      },
    };
    const synced = await runImapSyncJob(
      db,
      { accountId: saved.value.id, now: new Date("2026-11-03T08:00:00Z"), signal: softSignal() },
      deps,
    );
    if (!synced.ok) throw synced.error;
    const [message] = (
      await db.execute(sql`SELECT m.id,m.thread_id FROM email_messages m
        JOIN mail_message_locators l ON l.message_id=m.id AND l.account_id=m.account_id
        JOIN mail_folders f ON f.id=l.folder_id AND f.account_id=l.account_id
        WHERE m.account_id=${saved.value.id} AND f.path='INBOX' AND l.uid=2`)
    ).rows;
    if (typeof message?.id !== "string" || typeof message.thread_id !== "string")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Real IMAP conversation fixture missing");
    const activeSmtp = smtp;
    return {
      actor: hydrated.value,
      context: native.context,
      headers: native.headers,
      accountId: saved.value.id,
      threadId: message.thread_id,
      messageId: message.id,
      input,
      policy,
      imap,
      smtp: activeSmtp,
      runtime,
      deps,
      enqueueSync,
      enqueues: () => enqueues,
      runtimeLoads: () => runtimeLoads,
      stores: () => imap.state.commands.filter((command) => command === "STORE").length,
      close: () => closeProtocols(imap, activeSmtp),
    };
  } catch (error) {
    try {
      await closeProtocols(imap, smtp);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Soft mailbox setup and cleanup failed");
    }
    throw error;
  }
}

export type SoftMailbox = Awaited<ReturnType<typeof openSoftMailbox>>;

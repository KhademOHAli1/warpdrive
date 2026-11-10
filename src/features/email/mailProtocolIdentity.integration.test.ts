import { afterEach, describe, expect, it } from "vitest";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { startMailProtocolSmtp } from "@/test/mailProtocolSmtp";
import type { Result } from "@/types/result";
import { buildMime } from "./mime";
import { createImapTransport } from "./providers/imap";
import { parseRawMime } from "./providers/rawMime";
import { createSmtpTransport } from "./providers/smtp";

const fixtures: { close: () => Promise<void> }[] = [];
const signal = () => AbortSignal.timeout(5_000);
const identities = [
  {
    username: "first@mail.test",
    password: "synthetic-first-password",
    recipient: "first-recipient@mail.test",
    messageIdPrefix: "first-inbox",
    subject: "پیشنهاد همکاری برای شرکت اول",
  },
  {
    username: "second@mail.test",
    password: "synthetic-second-password",
    recipient: "second-recipient@mail.test",
    messageIdPrefix: "second-inbox",
    subject: "Anfragen für das zweite Unternehmen",
  },
] as const;

afterEach(async () => {
  const results = await Promise.allSettled(fixtures.splice(0).map((fixture) => fixture.close()));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length > 0) throw new AggregateError(failed, "Protocol fixtures did not close");
});

function value<T, E>(result: Result<T, E>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected the native protocol operation to succeed");
  return result.value;
}

async function mailbox(identity: (typeof identities)[number], starttls: boolean) {
  const imap = await startMailProtocolImap({ ...identity, starttls });
  fixtures.push(imap);
  const smtp = await startMailProtocolSmtp({ ...identity, starttls });
  fixtures.push(smtp);
  const credentials = {
    username: identity.username,
    password: identity.password,
    timeouts: { connectionMs: 2_000, greetingMs: 2_000, socketMs: 2_000 },
  };
  return {
    identity,
    imap,
    smtp,
    credentials,
    reader: createImapTransport({ ...credentials, endpoint: imap.endpoint }),
    sender: createSmtpTransport({ ...credentials, endpoint: smtp.endpoint }),
  };
}

async function pair(starttls: boolean) {
  const first = await mailbox(identities[0], starttls);
  const second = await mailbox(identities[1], starttls);
  return [first, second] as const;
}

describe("two independent native protocol mailboxes", () => {
  it.each([false, true])(
    "rejects crossed passwords and reads distinct MIME identities (STARTTLS=%s)",
    async (starttls) => {
      const [first, second] = await pair(starttls);
      for (const [current, other] of [
        [first, second],
        [second, first],
      ] as const) {
        const crossed = createImapTransport({
          ...current.credentials,
          endpoint: current.imap.endpoint,
          password: other.identity.password,
        });
        expect(await crossed.readFolder({ path: "INBOX", signal: signal() })).toEqual({
          ok: false,
          error: { kind: "authentication" },
        });
        const page = value(await current.reader.readFolder({ path: "INBOX", signal: signal() }));
        expect(page.messages.map((message) => message.uid)).toEqual([1, 2, 3]);
        for (const message of page.messages) {
          const parsed = value(await parseRawMime({ source: message.source, signal: signal() }));
          expect(parsed.subject).toBe(current.identity.subject);
          expect(parsed.to).toEqual([{ email: current.identity.recipient, name: null }]);
          expect(parsed.rfcMessageId).toBe(
            `<${current.identity.messageIdPrefix}-${message.uid}@mail.test>`,
          );
          expect(parsed.rfcMessageId).not.toContain(other.identity.messageIdPrefix);
          expect(parsed.subject).not.toBe(other.identity.subject);
        }
        expect(current.smtp.received).toHaveLength(0);
      }
    },
  );

  it.each([false, true])(
    "keeps accepted payloads and senders in their own SMTP stores (STARTTLS=%s)",
    async (starttls) => {
      const [first, second] = await pair(starttls);
      for (const [current, other] of [
        [first, second],
        [second, first],
      ] as const) {
        const raw = Buffer.from(
          buildMime({
            from: current.identity.username,
            to: [current.identity.recipient],
            subject: current.identity.subject,
            text: current.identity.subject,
            html: `<p>${current.identity.subject}</p>`,
            messageId: `<${current.identity.messageIdPrefix}-outgoing@mail.test>`,
          }),
        );
        const args = {
          from: current.identity.username,
          to: [current.identity.recipient],
          raw,
        };
        const crossed = createSmtpTransport({
          ...current.credentials,
          endpoint: current.smtp.endpoint,
          password: other.identity.password,
        });
        expect(await crossed.sendRaw({ ...args, signal: signal() })).toEqual({
          ok: false,
          error: { kind: "authentication", retrySafe: true },
        });
        expect(current.smtp.received).toHaveLength(0);
        const submission = value(await current.sender.sendRaw({ ...args, signal: signal() }));
        expect(submission.accepted).toEqual([current.identity.recipient]);
        expect(submission.rejected).toEqual([]);
        expect(current.smtp.received).toHaveLength(1);
        const received = current.smtp.received[0];
        if (received === undefined) throw new Error("Missing SMTP fixture payload");
        const parsed = value(await parseRawMime({ source: received, signal: signal() }));
        expect(parsed.from).toEqual([{ email: current.identity.username, name: null }]);
        expect(parsed.to).toEqual([{ email: current.identity.recipient, name: null }]);
        expect(parsed.subject).toBe(current.identity.subject);
        expect(parsed.text?.trim()).toBe(current.identity.subject);
        expect(parsed.rfcMessageId).toBe(
          `<${current.identity.messageIdPrefix}-outgoing@mail.test>`,
        );
        expect(received.toString()).not.toContain(other.identity.username);
      }
      expect(first.smtp.received).toHaveLength(1);
      expect(second.smtp.received).toHaveLength(1);
      expect(first.imap.state.folders.get("Sent")?.messages).toHaveLength(0);
      expect(second.imap.state.folders.get("Sent")?.messages).toHaveLength(0);
    },
  );
});

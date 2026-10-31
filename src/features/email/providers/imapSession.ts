import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import { err, type Result } from "@/types/result";
import { imapBoundedTransport } from "./imapSessionBudget";
import { IMAP_LIMITS, type ImapFailure, type ImapTransportConfig } from "./imapTypes";
import { RAW_MIME_LIMITS } from "./rawMimeTypes";
import { SMTP_TIMEOUTS } from "./smtpTypes";

const errorSchema = z.object({
  code: z.string().optional(),
  authenticationFailed: z.boolean().optional(),
  tlsFailed: z.boolean().optional(),
  serverResponseCode: z.string().optional(),
});

function classifyImapFailure(error: unknown, mutation: boolean): ImapFailure {
  const parsed = errorSchema.safeParse(error);
  const code = parsed.success ? (parsed.data.code ?? "") : "";
  if (code === "ResponseBudgetExceeded") return { kind: "unsupported" };
  if (
    parsed.success &&
    (parsed.data.authenticationFailed === true ||
      parsed.data.serverResponseCode === "AUTHENTICATIONFAILED")
  )
    return { kind: "authentication" };
  if (
    (parsed.success && parsed.data.tlsFailed === true) ||
    /TLS|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code)
  )
    return { kind: "tls" };
  if (parsed.success && parsed.data.serverResponseCode === "NONEXISTENT")
    return { kind: "mailbox_missing" };
  if (code === "LiteralTooLarge" || code === "LineTooLarge") return { kind: "message_too_large" };
  if (mutation) return { kind: "mutation_unknown" };
  return { kind: /TIMEOUT/i.test(code) ? "timeout" : "connection" };
}

function responseBudgetFailure(
  budget: ReturnType<typeof imapBoundedTransport>,
  mutation: boolean,
): ImapFailure | null {
  if (budget.exceeded()) return { kind: mutation ? "mutation_unknown" : "unsupported" };
  if (budget.timedOut()) return { kind: mutation ? "mutation_unknown" : "timeout" };
  return null;
}

export async function imapSession<T>(
  config: ImapTransportConfig,
  signal: AbortSignal,
  operation: (client: ImapFlow) => Promise<Result<T, ImapFailure>>,
  mode: "read" | "mutation" | "list" = "read",
): Promise<Result<T, ImapFailure>> {
  signal.throwIfAborted();
  const endpoint = config.endpoint;
  if (
    (endpoint.protocol !== "imaps" && endpoint.protocol !== "imap+starttls") ||
    !isIP(endpoint.address)
  )
    return err({ kind: "invalid_request" });
  const timeouts = { ...SMTP_TIMEOUTS, ...config.timeouts };
  const budget = imapBoundedTransport(endpoint, mode === "list");
  const client = new ImapFlow({
    host: endpoint.address,
    port: endpoint.port,
    secure: endpoint.protocol === "imaps",
    doSTARTTLS: endpoint.protocol === "imap+starttls",
    tls: endpoint.tls,
    servername: endpoint.tls.servername,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: timeouts.connectionMs,
    greetingTimeout: timeouts.greetingMs,
    socketTimeout: timeouts.socketMs,
    maxLiteralSize: RAW_MIME_LIMITS.messageBytes,
    maxLineLength: IMAP_LIMITS.responseLineBytes,
    transport: budget.transport,
    maxResponseSize:
      mode === "list"
        ? IMAP_LIMITS.responseLineBytes
        : RAW_MIME_LIMITS.messageBytes + IMAP_LIMITS.responseLineBytes,
    maxResponseTokens: 4096,
    disableCompression: true,
    disableAutoIdle: true,
    logger: false,
    logRaw: false,
    emitLogs: false,
  });
  const abort = () => client.close();
  client.on("error", () => {});
  signal.addEventListener("abort", abort, { once: true });
  let authenticated = false;
  try {
    await client.connect();
    signal.throwIfAborted();
    authenticated = true;
    const result = await operation(client);
    signal.throwIfAborted();
    const failure = responseBudgetFailure(budget, mode === "mutation");
    return failure === null ? result : err(failure);
  } catch (error) {
    signal.throwIfAborted();
    const mutation = mode === "mutation" && authenticated;
    return err(responseBudgetFailure(budget, mutation) ?? classifyImapFailure(error, mutation));
  } finally {
    signal.removeEventListener("abort", abort);
    client.close();
  }
}

export async function withImapFolder<T>(
  client: ImapFlow,
  path: string,
  signal: AbortSignal,
  operation: () => Promise<Result<T, ImapFailure>>,
): Promise<Result<T, ImapFailure>> {
  const lock = await client.getMailboxLock(path);
  try {
    signal.throwIfAborted();
    return await operation();
  } finally {
    lock.release();
  }
}

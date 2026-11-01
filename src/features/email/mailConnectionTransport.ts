import { createHash } from "node:crypto";
import { env } from "@/config/env";
import type { ConnectionEndpointPolicy } from "@/features/connections/connectionEndpoint";
import { resolveConnectionEndpoint } from "@/features/connections/endpointPolicy";
import { err, ok } from "@/types/result";
import type {
  CheckMailboxInput,
  MailboxConnectionError,
  MailboxConnectionResult,
} from "./connections/types";
import { createImapTransport } from "./providers/imap";
import type { ImapFailure } from "./providers/imapTypes";
import { createSmtpTransport } from "./providers/smtp";
import type { SmtpFailure } from "./providers/smtpTypes";

export const configuredMailEndpointPolicy = (): ConnectionEndpointPolicy => ({
  internalEndpoints: env.MAIL_INTERNAL_ENDPOINTS,
});

export function mailTransportFailure(
  kind: ImapFailure["kind"] | SmtpFailure["kind"],
): MailboxConnectionError {
  if (kind === "authentication" || kind === "tls") return kind;
  if (kind === "smtp_utf8_unsupported" || kind === "unsupported") return "unsupported";
  if (kind === "invalid_request") return "invalid_input";
  if (kind === "read_only") return "permission";
  if (kind === "submission_unknown" || kind === "mutation_unknown") return "delivery_unknown";
  if (kind === "uidvalidity_changed" || kind === "connection_changed") return "connection_changed";
  return "network";
}

export async function resolveMailboxTransports(
  input: CheckMailboxInput,
  signal: AbortSignal,
  policy = configuredMailEndpointPolicy(),
): Promise<
  MailboxConnectionResult<{
    imap: ReturnType<typeof createImapTransport>;
    smtp: ReturnType<typeof createSmtpTransport>;
    identityKey: string;
  }>
> {
  signal.throwIfAborted();
  const imap = await resolveConnectionEndpoint(
    {
      protocol: input.imap.security === "tls" ? "imaps" : "imap+starttls",
      host: input.imap.host,
      port: input.imap.port,
    },
    policy,
    signal,
  );
  if (!imap.ok) return err(imap.error.code === "dns_failed" ? "network" : "permission");
  const smtp = await resolveConnectionEndpoint(
    {
      protocol: input.smtp.security === "tls" ? "smtps" : "smtp+starttls",
      host: input.smtp.host,
      port: input.smtp.port,
    },
    policy,
    signal,
  );
  if (!smtp.ok) return err(smtp.error.code === "dns_failed" ? "network" : "permission");
  const identityKey = createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive-imap-v1",
        imap.value.hostname,
        imap.value.port,
        input.imap.username,
      ]),
    )
    .digest("hex");
  return ok({
    identityKey,
    imap: createImapTransport({
      endpoint: imap.value,
      username: input.imap.username,
      password: input.imap.password,
    }),
    smtp: createSmtpTransport({
      endpoint: smtp.value,
      username: input.smtp.username,
      password: input.smtp.password,
    }),
  });
}

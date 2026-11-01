import { isIP } from "node:net";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { SMTP_TIMEOUTS, type SmtpFailure, type SmtpTransportConfig } from "./smtpTypes";
import { smtpFailure } from "./smtpWire";

export async function smtpSession<T>(
  config: SmtpTransportConfig,
  signal: AbortSignal,
  operation: (connection: SMTPConnection, beginSubmission: () => boolean) => Promise<T>,
  sending: boolean,
): Promise<Result<T, SmtpFailure>> {
  signal.throwIfAborted();
  const endpoint = config.endpoint;
  if (
    (endpoint.protocol !== "smtps" && endpoint.protocol !== "smtp+starttls") ||
    !isIP(endpoint.address)
  )
    return err({ kind: "invalid_request", retrySafe: true });
  const timeouts = { ...SMTP_TIMEOUTS, ...config.timeouts };
  const connection = new SMTPConnection({
    host: endpoint.address,
    port: endpoint.port,
    secure: endpoint.protocol === "smtps",
    requireTLS: endpoint.protocol === "smtp+starttls",
    opportunisticTLS: false,
    tls: endpoint.tls,
    servername: endpoint.tls.servername,
    allowInternalNetworkInterfaces: true,
    connectionTimeout: timeouts.connectionMs,
    greetingTimeout: timeouts.greetingMs,
    socketTimeout: timeouts.socketMs,
    maxResponseSize: RAW_RESPONSE_LIMIT,
    logger: false,
    debug: false,
  });
  let rejectPending: (error: unknown) => void = () => {};
  let submissionStarted = false;
  let closed = false;
  const abort = () => {
    closed = true;
    rejectPending(signal.reason);
    connection.close();
  };
  const connectionError = (error: unknown) => {
    closed = true;
    rejectPending(error);
  };
  connection.on("error", connectionError);
  connection.on("end", () =>
    connectionError(
      Object.assign(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "Mail connection closed"), {
        code: "ECONNECTION",
      }),
    ),
  );
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectPending = reject;
      connection.connect((error) => (error === undefined ? resolve() : reject(error)));
    });
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      rejectPending = reject;
      connection.login({ user: config.username, pass: config.password }, (error) =>
        error === null ? resolve() : reject(error),
      );
    });
    signal.throwIfAborted();
    const outcome = await Promise.race([
      operation(connection, () => {
        if (closed || signal.aborted) return false;
        // AUTH and the application fence cannot submit a message. Certainty changes
        // only immediately before Nodemailer can issue the first MAIL command.
        submissionStarted = true;
        return true;
      }),
      new Promise<never>((_resolve, reject) => {
        rejectPending = reject;
      }),
    ]);
    signal.throwIfAborted();
    return ok(outcome);
  } catch (error) {
    signal.throwIfAborted();
    return err(smtpFailure(error, sending && submissionStarted));
  } finally {
    closed = true;
    signal.removeEventListener("abort", abort);
    // Keep an error listener while close drains the underlying TLS/socket callbacks.
    rejectPending = () => {};
    connection.close();
  }
}

const RAW_RESPONSE_LIMIT = 64 * 1024;

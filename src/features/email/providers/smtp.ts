import { err, ok, type Result } from "@/types/result";
import { smtpSession } from "./smtpSession";
import type {
  SmtpFailure,
  SmtpRawSubmission,
  SmtpSubmission,
  SmtpTransportConfig,
} from "./smtpTypes";
import { prepareSmtpRaw, smtpSupportsUtf8 } from "./smtpWire";

export type { SmtpFailure, SmtpSubmission, SmtpTransportConfig } from "./smtpTypes";

export function createSmtpTransport(config: SmtpTransportConfig) {
  return {
    verify({ signal }: { signal: AbortSignal }): Promise<Result<true, SmtpFailure>> {
      return smtpSession(config, signal, () => Promise.resolve(true as const), false);
    },

    async sendRaw(args: SmtpRawSubmission): Promise<Result<SmtpSubmission, SmtpFailure>> {
      args.signal.throwIfAborted();
      const prepared = prepareSmtpRaw(args.raw);
      if (
        prepared === null ||
        args.to.length === 0 ||
        args.to.length > MAX_RECIPIENTS ||
        [args.from, ...args.to].some((address) => address === "" || /[\r\n\0]/.test(address))
      )
        return err({ kind: "invalid_request", retrySafe: true });

      const result = await smtpSession(
        config,
        args.signal,
        async (connection, beginSubmission) => {
          if (
            [args.from, ...args.to].some((address) =>
              Array.from(address).some((character) => character.charCodeAt(0) > 127),
            ) &&
            !smtpSupportsUtf8(connection)
          )
            return err({ kind: "smtp_utf8_unsupported", retrySafe: true } as const);

          if (args.beforeSubmission !== undefined) {
            const permitted = await args.beforeSubmission(args.signal);
            args.signal.throwIfAborted();
            if (!permitted) return err({ kind: "connection_changed", retrySafe: true } as const);
          }

          if (!beginSubmission()) return err({ kind: "connection", retrySafe: true } as const);
          const response = await new Promise<SmtpSubmission>((resolve, reject) => {
            connection.send({ from: args.from, to: args.to }, prepared.raw, (error, info) => {
              if (error !== null) reject(error);
              else
                resolve({
                  accepted: info.accepted,
                  rejected: info.rejected,
                  partial: info.rejected.length > 0,
                  responseCode: Number.parseInt(info.response.slice(0, 3), 10),
                  messageId: prepared.messageId,
                  serverMessageId: info.serverMessageId ?? null,
                });
            });
          });
          return ok(response);
        },
        true,
      );
      return result.ok ? result.value : result;
    },
  };
}

const MAX_RECIPIENTS = 100;

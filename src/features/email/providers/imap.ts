import { err, ok, type Result } from "@/types/result";
import { fetchSingleImapMessage } from "./imapFetchOne";
import { inspectImapMessages } from "./imapInspect";
import { readImapFolder, validImapUid } from "./imapRead";
import { imapSession, withImapFolder } from "./imapSession";
import {
  IMAP_LIMITS,
  type ImapFailure,
  type ImapMessageArgs,
  type ImapMutationArgs,
  type ImapReadArgs,
  type ImapTransportConfig,
  type ImapWriteArgs,
} from "./imapTypes";
import { RAW_MIME_LIMITS } from "./rawMimeTypes";

async function mutationCurrent(args: ImapWriteArgs): Promise<boolean> {
  const current = await args.beforeMutation?.(args.signal);
  args.signal.throwIfAborted();
  return current !== false;
}

export type { ImapFailure, ImapFolderPage, ImapTransportConfig } from "./imapTypes";

function validMutation(args: ImapMutationArgs): boolean {
  return (
    args.uids.length > 0 &&
    args.uids.length <= IMAP_LIMITS.pageMessages &&
    args.uids.every(validImapUid)
  );
}

export function createImapTransport(config: ImapTransportConfig) {
  return {
    verify({ signal }: { signal: AbortSignal }) {
      return imapSession(config, signal, () => Promise.resolve(ok(true as const)));
    },
    inspectFolder(args: { path: string; signal: AbortSignal }) {
      return imapSession(config, args.signal, (client) =>
        withImapFolder(client, args.path, args.signal, () => {
          if (client.mailbox === false)
            return Promise.resolve(err({ kind: "mailbox_missing" } as const));
          return Promise.resolve(
            ok({
              uidValidity: client.mailbox.uidValidity.toString(),
              uidNext: client.mailbox.uidNext,
              readOnly: client.mailbox.readOnly === true,
              messageCount: client.mailbox.exists,
            }),
          );
        }),
      );
    },
    listFolders({ signal }: { signal: AbortSignal }) {
      return imapSession(
        config,
        signal,
        async (client) => {
          const folders = await client.list();
          signal.throwIfAborted();
          if (folders.length > IMAP_LIMITS.folderCount) return err({ kind: "unsupported" });
          return ok({
            folders: folders.map((folder) => ({
              path: folder.path,
              name: folder.name,
              delimiter: folder.delimiter,
              specialUse: folder.specialUse ?? null,
              authoritativeSpecialUse:
                folder.specialUse !== undefined && folder.flags.has(folder.specialUse),
              selectable: !folder.flags.has("\\Noselect"),
            })),
            canMove: client.capabilities.has("MOVE"),
          });
        },
        "list",
      );
    },
    readFolder(args: ImapReadArgs) {
      args.signal.throwIfAborted();
      if (
        (args.afterUid !== undefined && args.afterUid !== 0 && !validImapUid(args.afterUid)) ||
        (args.limit !== undefined &&
          (!Number.isInteger(args.limit) ||
            args.limit < 1 ||
            args.limit > IMAP_LIMITS.pageMessages)) ||
        (args.since !== undefined && Number.isNaN(args.since.getTime()))
      )
        return Promise.resolve(err({ kind: "invalid_request" } as const));
      return imapSession(config, args.signal, (client) =>
        withImapFolder(client, args.path, args.signal, () => readImapFolder(client, args)),
      );
    },
    getSource(args: ImapMessageArgs): Promise<Result<Buffer, ImapFailure>> {
      if (!validImapUid(args.uid)) return Promise.resolve(err({ kind: "invalid_request" }));
      return imapSession(config, args.signal, (client) =>
        withImapFolder(client, args.path, args.signal, async () => {
          if (client.mailbox === false) return err({ kind: "mailbox_missing" });
          if (client.mailbox.uidValidity.toString() !== args.uidValidity)
            return err({ kind: "uidvalidity_changed" });
          const source = await fetchSingleImapMessage(
            client,
            args.uid,
            { uid: true, source: true, size: true },
            args.signal,
          );
          args.signal.throwIfAborted();
          if (!source.ok) return source;
          const fetched = source.value;
          if (fetched === null || fetched.source === undefined)
            return err({ kind: "message_missing" });
          if (fetched.source.length > RAW_MIME_LIMITS.messageBytes)
            return err({ kind: "message_too_large" });
          return ok(fetched.source);
        }),
      );
    },
    inspectMessages(args: ImapMutationArgs) {
      if (!validMutation(args)) return Promise.resolve(err({ kind: "invalid_request" } as const));
      return imapSession(config, args.signal, (client) =>
        withImapFolder(client, args.path, args.signal, () => inspectImapMessages(client, args)),
      );
    },
    setFlags(args: ImapWriteArgs & { flags: string[]; mode: "add" | "remove" | "replace" }) {
      if (!validMutation(args) || args.flags.some((flag) => flag === "" || /[\r\n\0]/.test(flag)))
        return Promise.resolve(err({ kind: "invalid_request" } as const));
      return imapSession(
        config,
        args.signal,
        (client) =>
          withImapFolder(client, args.path, args.signal, async () => {
            if (client.mailbox === false) return err({ kind: "mailbox_missing" });
            if (client.mailbox.uidValidity.toString() !== args.uidValidity)
              return err({ kind: "uidvalidity_changed" });
            if (client.mailbox.readOnly === true) return err({ kind: "read_only" });
            if (!(await mutationCurrent(args))) return err({ kind: "connection_changed" });
            const operation =
              args.mode === "add"
                ? client.messageFlagsAdd.bind(client)
                : args.mode === "remove"
                  ? client.messageFlagsRemove.bind(client)
                  : client.messageFlagsSet.bind(client);
            const result = await operation(args.uids, args.flags, { uid: true });
            args.signal.throwIfAborted();
            return result ? ok(true as const) : err({ kind: "mutation_unknown" });
          }),
        "mutation",
      );
    },
    moveMessages(args: ImapWriteArgs & { destination: string }) {
      if (!validMutation(args)) return Promise.resolve(err({ kind: "invalid_request" } as const));
      return imapSession(
        config,
        args.signal,
        (client) =>
          withImapFolder(client, args.path, args.signal, async () => {
            if (!client.capabilities.has("MOVE")) return err({ kind: "unsupported" });
            if (client.mailbox === false) return err({ kind: "mailbox_missing" });
            if (client.mailbox.uidValidity.toString() !== args.uidValidity)
              return err({ kind: "uidvalidity_changed" });
            if (client.mailbox.readOnly === true) return err({ kind: "read_only" });
            if (!(await mutationCurrent(args))) return err({ kind: "connection_changed" });
            const result = await client.messageMove(args.uids, args.destination, { uid: true });
            args.signal.throwIfAborted();
            return result === false
              ? err({ kind: "mutation_unknown" })
              : ok({
                  path: args.destination,
                  uidValidity: result.uidValidity?.toString() ?? null,
                  uidMap: [...(result.uidMap ?? new Map<number, number>())].flatMap(
                    ([sourceUid, destinationUid]) =>
                      args.uids.includes(sourceUid) && validImapUid(destinationUid)
                        ? [{ sourceUid, destinationUid }]
                        : [],
                  ),
                });
          }),
        "mutation",
      );
    },
    appendSent(args: {
      path: string;
      source: Buffer;
      signal: AbortSignal;
      beforeAppend?: (signal: AbortSignal) => Promise<boolean>;
    }) {
      if (args.source.length > RAW_MIME_LIMITS.messageBytes)
        return Promise.resolve(err({ kind: "message_too_large" } as const));
      return imapSession(
        config,
        args.signal,
        async (client) => {
          const current = await args.beforeAppend?.(args.signal);
          args.signal.throwIfAborted();
          if (current === false) return err({ kind: "connection_changed" });
          const result = await client.append(args.path, args.source, ["\\Seen"]);
          args.signal.throwIfAborted();
          return result === false
            ? err({ kind: "protocol" })
            : ok({ uid: result.uid ?? null, uidValidity: result.uidValidity?.toString() ?? null });
        },
        "mutation",
      );
    },
  };
}

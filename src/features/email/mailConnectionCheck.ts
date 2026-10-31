import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ConnectionEndpointPolicy } from "@/features/connections/connectionEndpoint";
import { err, ok } from "@/types/result";
import type {
  CheckedMailboxConnection,
  CheckMailboxInput,
  MailboxConnectionResult,
} from "./connections/types";
import { createMailboxProof } from "./mailConnectionProofs";
import { checkMailboxInputSchema, type MailboxActorSession } from "./mailConnectionSchemas";
import {
  configuredMailEndpointPolicy,
  mailTransportFailure,
  resolveMailboxTransports,
} from "./mailConnectionTransport";
import { discoverMailFolders } from "./mailFolderDiscovery";

interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  identity_key: string | null;
  connection_generation: number;
}

async function findConnectionIdentity(db: Db, input: CheckMailboxInput, identityKey: string) {
  const rows = (
    await db.execute(sql`
    SELECT id, user_id, provider, email_address, identity_key, connection_generation
    FROM email_accounts WHERE identity_key=${identityKey} OR email_address=${input.emailAddress}
      OR email_address=${input.imap.username}
      OR id=${input.accountId ?? null}::uuid
  `)
  ).rows as unknown as IdentityRow[];
  return rows;
}

export async function checkMailboxConnection(
  db: Db,
  context: MailboxActorSession,
  raw: unknown,
  signal: AbortSignal,
  deps: { policy: ConnectionEndpointPolicy } = { policy: configuredMailEndpointPolicy() },
): Promise<MailboxConnectionResult<CheckedMailboxConnection>> {
  const parsed = checkMailboxInputSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input");
  const input = parsed.data;
  const transports = await resolveMailboxTransports(input, signal, deps.policy);
  if (!transports.ok) return transports;
  const identities = await findConnectionIdentity(db, input, transports.value.identityKey);
  signal.throwIfAborted();
  const reconnect = identities.find((row) => row.id === input.accountId);
  if (
    input.accountId !== undefined &&
    (reconnect === undefined ||
      reconnect.user_id !== context.actorId ||
      reconnect.provider !== "imap_smtp" ||
      reconnect.identity_key !== transports.value.identityKey ||
      reconnect.email_address.toLowerCase() !== input.emailAddress.toLowerCase())
  )
    return err("connection_changed");
  if (identities.some((row) => row.id !== input.accountId)) return err("duplicate");
  const listed = await transports.value.imap.listFolders({ signal });
  if (!listed.ok) return err(mailTransportFailure(listed.error.kind));
  const verified = await transports.value.smtp.verify({ signal });
  if (!verified.ok) return err(mailTransportFailure(verified.error.kind));
  const discovered = await discoverMailFolders(transports.value.imap, listed.value, signal);
  if (!discovered.ok) return discovered;
  const { folders, trashWritable } = discovered.value;
  const writable = folders.some((folder) => folder.readOnly === false);
  const capabilities = {
    read: true,
    send: true,
    markRead: writable,
    move: writable && listed.value.canMove,
    trash: writable && listed.value.canMove && trashWritable,
  };
  const stored = await createMailboxProof(
    db,
    context,
    {
      input,
      identityKey: transports.value.identityKey,
      folders,
      capabilities,
      ...(reconnect === undefined ? {} : { generation: reconnect.connection_generation }),
    },
    signal,
  );
  if (!stored.ok) return stored;
  return ok({
    checkId: stored.value.checkId,
    mailboxAddress: input.emailAddress,
    folders,
    capabilities,
  });
}

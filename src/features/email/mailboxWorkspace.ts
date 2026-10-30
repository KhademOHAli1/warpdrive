import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { INBOX_PAGE_SIZE } from "@/constants/inbox";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { type InboxCursor, quickFilterPredicate } from "./inboxList";
import { INBOX_VIEWS, type InboxView, MAILBOX_FILTERS } from "./inboxLocation";
import { type AttributeFilterState, NO_ATTRIBUTE_FILTER } from "./threadAttributeFilter";
import { type InboxFilter, type ThreadRow, toInboxThread } from "./threadShape";

export const mailboxWorkspaceInput = z.object({
  folder: z.enum(["inbox", "sent", "archive"]).default("inbox"),
  query: z.string().max(200).default(""),
  filter: z.enum(MAILBOX_FILTERS).default("all"),
  view: z.enum(INBOX_VIEWS).default("all"),
  attributes: z
    .object({
      followUp: z.string().max(32),
      label: z.string().max(100),
      hasAttachment: z.boolean(),
      unreadOnly: z.boolean(),
      dateRange: z.enum(["any", "7d", "30d"]),
    })
    .default(NO_ATTRIBUTE_FILTER),
  limit: z.number().int().min(1).max(INBOX_PAGE_SIZE).optional(),
  cursor: z.object({ lastMessageAt: z.string().nullable(), id: z.string().uuid() }).nullish(),
});

interface WorkspaceArgs {
  actor: AuthUser;
  folder: "inbox" | "sent" | "archive";
  query?: string;
  filter?: InboxFilter;
  view?: InboxView;
  attributes?: AttributeFilterState;
  limit?: number;
  cursor?: InboxCursor | null;
}
const unread = sql`(r.read_at IS NULL OR (t.last_message_at IS NOT NULL AND r.read_at < t.last_message_at))`;
const attachment = sql`EXISTS (SELECT 1 FROM email_message_attachments att JOIN email_messages am ON am.id=att.message_id WHERE am.thread_id=t.id)`;
const from = sql`FROM email_threads t JOIN email_accounts a ON a.id=t.account_id`;

function folderPredicate(folder: WorkspaceArgs["folder"], query: string): SQL {
  if (query !== "") return sql`true`;
  if (folder === "archive") return sql`t.archived_at IS NOT NULL`;
  if (folder === "sent")
    return sql`EXISTS (SELECT 1 FROM email_messages sm WHERE sm.thread_id=t.id AND sm.direction='outbound' AND sm.sent_at IS NOT NULL)`;
  return sql`t.archived_at IS NULL`;
}

function predicate(args: WorkspaceArgs): SQL {
  const attr = args.attributes ?? NO_ATTRIBUTE_FILTER;
  const query = args.query?.trim() ?? "";
  const since =
    attr.dateRange === "any"
      ? null
      : new Date(Date.now() - (attr.dateRange === "7d" ? 7 : 30) * 86_400_000);
  const filter = args.filter ?? "all";
  return sql`a.user_id=${args.actor.id} AND t.trashed_at IS NULL AND ${folderPredicate(args.folder, query)}
    AND ${quickFilterPredicate(filter)}
    AND ${filter === "unmatched" ? sql`t.person_id IS NULL AND t.deal_id IS NULL` : filter === "needs_linking" ? sql`t.person_id IS NULL` : sql`true`}
    AND ${args.view === "unread" || attr.unreadOnly ? unread : sql`true`}
    AND ${args.view === "waiting" ? sql`t.follow_up_status='waiting'` : sql`true`}
    AND ${attr.followUp !== "" ? sql`t.follow_up_status=${attr.followUp}` : sql`true`}
    AND ${attr.label !== "" ? sql`${attr.label}=ANY(t.labels)` : sql`true`}
    AND ${attr.hasAttachment ? attachment : sql`true`}
    AND ${since !== null ? sql`t.last_message_at >= ${since.toISOString()}` : sql`true`}
    AND ${
      query === ""
        ? sql`true`
        : sql`(t.subject ILIKE ${`%${query}%`} OR EXISTS (
      SELECT 1 FROM email_messages qm WHERE qm.thread_id=t.id AND (
        qm.body_text ILIKE ${`%${query}%`} OR qm.snippet ILIKE ${`%${query}%`}
        OR qm.to_emails::text ILIKE ${`%${query}%`} OR qm.cc_emails::text ILIKE ${`%${query}%`}
        OR qm.from_email ILIKE ${`%${query}%`} OR qm.from_name ILIKE ${`%${query}%`}
      )))`
    }`;
}

function after(cursor: InboxCursor | null): SQL {
  if (cursor === null) return sql`true`;
  if (cursor.lastMessageAt === null) return sql`t.last_message_at IS NULL AND t.id < ${cursor.id}`;
  return sql`(t.last_message_at IS NULL OR t.last_message_at < ${cursor.lastMessageAt} OR (t.last_message_at=${cursor.lastMessageAt} AND t.id < ${cursor.id}))`;
}

// Every candidate is owned by this actor in SQL, including search across archived/sent mail.
// Filtering precedes pagination, and the count uses exactly the same predicate as the page.
export async function readMailboxWorkspace(db: Db, args: WorkspaceArgs, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!args.actor.isActive) return { threads: [], total: 0, nextCursor: null };
  const limit = args.limit ?? INBOX_PAGE_SIZE;
  const where = predicate(args);
  const reads = sql`LEFT JOIN email_thread_reads r ON r.thread_id=t.id AND r.user_id=${args.actor.id}`;
  const [countResult, pageResult] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS total ${from} ${reads} WHERE ${where}`),
    db.execute(sql`SELECT t.id,t.subject,t.last_message_at,t.person_id,t.deal_id,t.visibility,t.account_id,
      t.follow_up_status,t.labels,a.user_id AS owner_user_id,${unread} AS unread,${attachment} AS has_attachment,
      COALESCE(co.from_email,lm.to_emails->>0,lm.from_email) AS sender_email,
      COALESCE(NULLIF(p.name,''),co.from_name) AS sender_name,lm.snippet
      ${from} ${reads} LEFT JOIN persons p ON p.id=t.person_id
      LEFT JOIN LATERAL (SELECT m.from_email,m.to_emails,m.snippet FROM email_messages m WHERE m.thread_id=t.id ORDER BY m.sent_at DESC NULLS LAST,m.created_at DESC LIMIT 1) lm ON true
      LEFT JOIN LATERAL (SELECT m.from_email,m.from_name FROM email_messages m WHERE m.thread_id=t.id AND lower(m.from_email)<>lower(a.email_address) ORDER BY m.sent_at DESC NULLS LAST,m.created_at DESC LIMIT 1) co ON true
      WHERE ${where} AND ${after(args.cursor ?? null)}
      ORDER BY t.last_message_at DESC NULLS LAST,t.id DESC LIMIT ${limit + 1}`),
  ]);
  signal.throwIfAborted();
  const rows = (
    pageResult.rows as unknown as (Omit<ThreadRow, "last_message_at"> & {
      last_message_at: string | Date | null;
    })[]
  ).map((row) => ({
    ...row,
    last_message_at:
      row.last_message_at instanceof Date ? row.last_message_at.toISOString() : row.last_message_at,
  }));
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined
      ? { lastMessageAt: last.last_message_at, id: last.id }
      : null;
  return {
    threads: page.map((row) => toInboxThread(row, args.actor.id)),
    total: Number((countResult.rows[0] as { total: number }).total),
    nextCursor,
  };
}

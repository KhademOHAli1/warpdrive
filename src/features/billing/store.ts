import { and, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import {
  BILLING_SCOPE,
  type BillingAccount,
  BillingError,
  type BillingOperation,
  type BillingStore,
  type BillingTransaction,
} from "./contracts";
import {
  billingAccounts,
  billingAuditEvents,
  billingOperations,
  billingWebhookReceipts,
} from "./schema";

function accountRow(row: typeof billingAccounts.$inferSelect): BillingAccount {
  if (!["never", "current", "needs_review"].includes(row.syncState))
    throw new BillingError("reconciliation_required");
  return { ...row, syncState: row.syncState as BillingAccount["syncState"] };
}
function operationRow(row: typeof billingOperations.$inferSelect): BillingOperation {
  if (row.kind !== "customer" && row.kind !== "checkout" && row.kind !== "seats")
    throw new BillingError("reconciliation_required");
  return { ...row, kind: row.kind };
}

export class DrizzleBillingStore implements BillingStore {
  constructor(
    private readonly db: Db,
    private readonly signal: AbortSignal,
  ) {}

  async readAccount(livemode: boolean) {
    this.signal.throwIfAborted();
    const [row] = await this.db
      .select()
      .from(billingAccounts)
      .where(and(eq(billingAccounts.scope, BILLING_SCOPE), eq(billingAccounts.livemode, livemode)))
      .limit(1);
    this.signal.throwIfAborted();
    return row ? accountRow(row) : null;
  }

  async activeUserCount() {
    this.signal.throwIfAborted();
    const [row] = await this.db
      .select({ count: count() })
      .from(users)
      .where(eq(users.isActive, true));
    this.signal.throwIfAborted();
    return row?.count ?? 0;
  }

  async withAccount<T>(
    livemode: boolean,
    work: (tx: BillingTransaction) => Promise<T>,
  ): Promise<T> {
    this.signal.throwIfAborted();
    return this.db.transaction(
      async (db) => {
        await db.execute(
          sql`SELECT set_config('statement_timeout', '10000', true), set_config('lock_timeout', '2000', true)`,
        );
        await db.insert(billingAccounts).values({ livemode }).onConflictDoNothing();
        const [row] = await db
          .select()
          .from(billingAccounts)
          .where(
            and(eq(billingAccounts.scope, BILLING_SCOPE), eq(billingAccounts.livemode, livemode)),
          )
          .for("update")
          .limit(1);
        if (!row) throw new BillingError("not_ready");
        const account = accountRow(row);
        const owned = and(eq(billingOperations.accountId, account.id));
        const tx: BillingTransaction = {
          account,
          async saveAccount(patch) {
            await db
              .update(billingAccounts)
              .set({ ...patch, updatedAt: new Date() })
              .where(eq(billingAccounts.id, account.id));
            Object.assign(account, patch);
          },
          async operation(kind, requestKey) {
            const [op] = await db
              .select()
              .from(billingOperations)
              .where(
                and(
                  owned,
                  eq(billingOperations.kind, kind),
                  eq(billingOperations.requestKey, requestKey),
                ),
              )
              .limit(1);
            return op ? operationRow(op) : null;
          },
          async operationById(id) {
            const [op] = await db
              .select()
              .from(billingOperations)
              .where(and(owned, eq(billingOperations.id, id)))
              .limit(1);
            return op ? operationRow(op) : null;
          },
          async reserveOperation(kind, requestKey, fingerprint) {
            const [op] = await db
              .insert(billingOperations)
              .values({ accountId: account.id, kind, requestKey, fingerprint })
              .returning();
            if (!op) throw new BillingError("not_ready");
            return operationRow(op);
          },
          async completeOperation(operationId, resourceId) {
            const [changed] = await db
              .update(billingOperations)
              .set({ resourceId, completedAt: new Date() })
              .where(and(owned, eq(billingOperations.id, operationId)))
              .returning({ id: billingOperations.id });
            if (!changed) throw new BillingError("request_conflict");
          },
          async hasEvent(eventId) {
            const [found] = await db
              .select({ id: billingWebhookReceipts.eventId })
              .from(billingWebhookReceipts)
              .where(
                and(
                  eq(billingWebhookReceipts.eventId, eventId),
                  eq(billingWebhookReceipts.accountId, account.id),
                ),
              )
              .limit(1);
            return found !== undefined;
          },
          async completeEvent(event) {
            await db.insert(billingWebhookReceipts).values({
              eventId: event.id,
              accountId: account.id,
              type: event.type,
              digest: event.digest,
              providerCreated: event.created,
            });
          },
          async audit(action, actorId, metadata = {}) {
            await db
              .insert(billingAuditEvents)
              .values({ accountId: account.id, action, actorId, metadata });
          },
        };
        const result = await work(tx);
        this.signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "read committed" },
    );
  }
}

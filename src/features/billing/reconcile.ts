import { BillingError, type BillingTransaction } from "./contracts";
import type { StripeGateway } from "./stripe/gateway";

type Gateway = Pick<StripeGateway, "searchCustomers" | "listCheckouts">;
export async function recoverCustomer(tx: BillingTransaction, stripe: Gateway): Promise<boolean> {
  if (tx.account.customerId !== null) return true;
  const op = await tx.operation("customer", "initial");
  if (op === null) return false;
  const matches = await stripe.searchCustomers(tx.account.id);
  const customer = matches[0];
  if (matches.length !== 1 || customer === undefined)
    throw new BillingError("reconciliation_required");
  await tx.saveAccount({ customerId: customer.id });
  await tx.completeOperation(op.id, customer.id);
  return true;
}
export async function recoverCheckout(tx: BillingTransaction, stripe: Gateway) {
  if (tx.account.checkoutOperationId === null) return null;
  const op = await tx.operationById(tx.account.checkoutOperationId);
  if (op === null || op.resourceId !== null) return null;
  const customerId = tx.account.customerId;
  if (customerId === null) throw new BillingError("reconciliation_required");
  let cursor: string | undefined;
  const found = [];
  for (let page = 0; page < 10; page++) {
    const result = await stripe.listCheckouts(customerId, cursor);
    found.push(
      ...result.data.filter(
        (c) => c.metadata.warpdrive_operation_key === `warpdrive:checkout:${op.id}`,
      ),
    );
    if (!result.has_more) break;
    if (result.next_cursor === null || result.next_cursor === cursor || page === 9)
      throw new BillingError("reconciliation_required");
    cursor = result.next_cursor;
  }
  const checkout = found[0];
  if (found.length !== 1 || checkout === undefined)
    throw new BillingError("reconciliation_required");
  return { op, checkout };
}

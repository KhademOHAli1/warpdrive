# Workspace subscription billing (#978)

This increment implements the backend and administrator Settings interface for a Warpdrive-operated, Germany/EU-first offering: a workspace fee plus optional paid seats, billed monthly or annually in EUR. It is disabled by default. Existing MIT licensing and existing installation access are unchanged. It does not implement the separate feature in which CRM customers issue invoices to their own clients.

## Deployment boundary

The current application has one workspace per installation/database. The billing account is scoped to that installation, with separate test/live records. It is not a multitenant authorization design. Enable it only on infrastructure operated by Warpdrive. Merchant Stripe secrets must never be supplied to a customer-controlled installation. A future shared multitenant service requires explicit authenticated workspace routing and storage isolation before reusing this code.

Canonical issue: https://github.com/KhademOHAli1/warpdrive/issues/978.

## Implemented source

- Server-owned Stripe customer association; no client-supplied customer IDs, prices, currencies or redirect destinations.
- Checkout with one workspace item and optional seat item. Configured prices must be active EUR recurring licensed prices for the selected interval. Additional seats equal `max(0, requested capacity - included capacity)`.
- Provider-hosted customer portal for billing identity/tax details, payment methods, invoice payment/history and cancellation. The app stores no PAN, CVC, full debit account or portal-session URL.
- Authorized invoice listing, finalized invoice PDF redirects, receipt listing/redirects and masked payment-method summaries. A receipt is available only where Stripe has a successful charge receipt; a paid invoice does not imply a separate charge receipt exists.
- Seat change preview and explicit confirmation. A signed 15-minute quote binds account, subscription, previous items, quantity, proration time and estimated amount. Confirmation rechecks state, active-user capacity and the preview. Updates use `pending_if_incomplete` and current Stripe items remain capacity authority while payment is pending.
- Durable operation reservations commit before customer/checkout/seat mutations. Stable provider idempotency keys support lost-response retries. A conflicting request or a different request during an unresolved checkout fails closed. No automatic retry after Stripe's idempotency retention may have expired; the local safety window is 20 hours.
- Recovery of an unknown customer/checkout result from exact server-owned metadata. Customer search can be eventually consistent; no match does not permit creating a second customer. Unknown seat mutations beyond the safe retry window require operator reconciliation against Stripe; there is no unsafe automatic reset.
- Raw-body HMAC signatures, bounded bodies, timestamp tolerance, snapshot API-version pin, test/live checks and customer binding. Completed event IDs are stored transactionally with a body hash. Current customer/subscription state is retrieved under a database account lock, so delayed events cannot overwrite newer state from an old payload.
- Current administrator authorization, fresh authentication for commands, same-origin CSRF, durable rate limiting, no-store responses and minimal billing audit evidence. An administrator can manage this workspace's billing; delegated finance roles are a later explicit permission addition.

A canceled/backed-out checkout can be continued from the owned open session returned by overview. It is not offered as a new purchase while a nonterminal subscription exists. If Stripe deletes a customer, the signed event clears the current binding and marks billing for review. Normal cancellation must retain the customer and its document history. This deletion case never automatically creates another customer: a merchant operator must first verify the old customer's cancellation/deletion, identify or create exactly one replacement in the same Stripe account with `metadata.warpdrive_account_id` equal to this installation's `billing_accounts.id`, and use the authorized reconciliation command. Zero, multiple or mismatched search results keep the review state; a deleted customer's historical documents remain a merchant-support/archive responsibility.

Subscription state, successful payment, invoice finalization and bank settlement are separate concepts. A checkout success query string never grants capacity or marks an invoice paid.

## API for the Settings frontend

All endpoints except the signed webhook require a current administrator session. Commands additionally require fresh authentication, the existing `wd_csrf` double-submit token, same-origin JSON and `x-csrf-token`. Bodies reject undeclared top-level fields. Every result is JSON `{ok:true,data:...}` or `{ok:false,error:{code:...}}`, except a successful document download which responds with an authorized, no-store 303 to Stripe.

| Method | Endpoint                                     | Result                                                                             |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/billing` or `/api/billing/overview`    | Payer summary, tax-ID check states, subscription/capacity and synchronization time |
| GET    | `/api/billing/invoices?cursor=in_...`        | Paginated Stripe invoice metadata and canonical hosted/PDF links                   |
| GET    | `/api/billing/invoices/in_.../download`      | Owned finalized invoice PDF redirect                                               |
| GET    | `/api/billing/receipts?cursor=ch_...`        | Paginated successful charge receipts; cursor advances across filtered charges      |
| GET    | `/api/billing/receipts/ch_.../download`      | Owned successful charge receipt redirect                                           |
| GET    | `/api/billing/payment-methods?cursor=pm_...` | Masked methods; the payer summary reports the customer invoice default             |
| POST   | `/api/billing`                               | One of the commands below                                                          |
| POST   | `/api/billing/stripe/webhook`                | Stripe snapshot events; signature authorization replaces session/CSRF              |

Commands:

```json
{"action":"checkout","requestId":"<UUID>","interval":"monthly","totalSeats":5,"profile":{"name":"Example GmbH","email":"finance@example.test","address":{"line1":"Example street 1","city":"Berlin","postalCode":"10115","country":"DE"}}}
{"action":"portal","intent":"overview"}
{"action":"portal","intent":"payment_methods"}
{"action":"portal","intent":"cancel"}
{"action":"preview_seats","totalSeats":7}
{"action":"change_seats","requestId":"<UUID>","quote":"<unchanged server-issued quote>"}
{"action":"reconcile"}
```

Persist a checkout/seat request UUID while its result is uncertain. Retrying with a new UUID is not recovery. Show pending payment, expired quote, changed preview, provider outage and reconciliation-required separately. Payment method setup does not itself buy a subscription. Do not include bearer portal/PDF/receipt URLs in analytics or logs.

The administrator-only `/settings/billing` page offers checkout, provider-hosted payment/profile management, cancellation, masked payment methods, paginated invoice/receipt access and quoted seat changes. It reloads authoritative state after returning from Stripe; return parameters do not assert payment. Commands preserve their request identity across an uncertain reply. English, German and Persian text and protected capture classes apply to payer/payment content.

The API holds the shared current-authority fence across active-user capacity reads and provider writes. Cooperating invitation/reactivation writers take its exclusive side. This prevents membership changes during purchase admission. It does not impose a new global paid-access gate or reject later invitations above purchased capacity. Suspension/grace periods, invitation enforcement, trials and post-cancellation access need an explicit commercial access policy; billing must remain reachable for payment recovery.

## Stripe and merchant configuration

No Stripe account, price, payment method, webhook, subscription or charge was created by this task.

1. Complete Warpdrive's merchant account verification, actual seller legal/tax details, payout destination, support/refund/cancellation policies and tax registrations for the launch scope. Select the actual business's direct Stripe account. Ordinary CRM subscribers do not need Stripe Connect accounts or merchant KYC.
2. Create four active EUR, fixed recurring, licensed prices: workspace monthly/yearly and additional seat monthly/yearly. Choose included seats and amounts explicitly. The backend does not invent prices, VAT rates, tax registrations or a free trial.
3. Create a portal configuration with billing/customer updates (name, address, email and tax IDs), invoice history, payment method updates and cancellation, preferably at period end. Keep general subscription updates disabled: Stripe's portal cannot update a multi-product workspace-plus-seat subscription. Use the custom quoted seat flow. Plan/interval changes and negotiated contracts remain operator-managed until a reviewed API is added.
4. Configure Stripe Tax and the actual registrations/product tax codes. A VAT ID being saved or verified is not full name/address or transaction-tax verification. Keep electronic-invoice requirements and recipient consent separate from Stripe's PDF generation.
5. Set the `.env.example` billing variables. Keys support `_FILE` through the existing single environment boundary. Use distinct sandbox/live keys, prices, portal configuration and webhook secret. Enable `BILLING_ENABLED=true` and `BILLING_MANAGED_HOSTING=true` only after the migration and checks below. `STRIPE_INCLUDED_SEATS` must be explicit. The initial payer-country list is a subset of EU member countries. It validates the submitted setup address; it is not a geographic restriction on later changes in Stripe Checkout or the portal. Verify the actual product/tax coverage and merchant selling scope.
6. Register an HTTPS **snapshot** webhook at `/api/billing/stripe/webhook`, pinned to **2026-10-28.endive**. Subscribe to checkout completion/expiry/asynchronous result, customer updates/deletion/tax-ID changes, subscription create/update/delete/pause/resume, invoice paid/payment-failed/payment-action-required/finalization-failed/voided/uncollectible and relevant payment/refund events. Payment-method reads remain canonical even when detached-method events lack a customer association.
7. Configure failed-payment notifications, retries and collection recovery in Stripe. Test them rather than treating enabled configuration as delivered email or recovered funds. Reconcile missed webhook delivery using the authorized overview/reconcile path and Stripe's delivery dashboard. Event processing failures return non-2xx for retry; unknown customers from this merchant's other installations are acknowledged and ignored.

The REST adapter uses built-in fetch and crypto with a pinned API version, bounded responses/timeouts, validated wire schemas and sanitized failures. No package/lockfile change or SDK installation was needed. Review the adapter and schema when upgrading the API or enabling thin events.

## Schema and integration admission

Four new module tables hold an installation customer binding/current subscription snapshot, durable operation keys, webhook receipts and minimal billing audit events. Financial profile and issued invoice authority remain in Stripe, not in CRM `organizations`. Raw webhook bodies, private provider errors, payment secrets and signed document/portal URLs are not persisted.

Canonical migration `drizzle/0105_workspace_billing.sql` and its complete application snapshot were generated from the full Drizzle model. Historical SQL and snapshots are preserved; the journal appends ordinal 105. The SQL is byte-equal to the reviewed `schema-proposal.sql`. Run the canonical application migrator, not the proposal file, on an installation.

Local real-PostgreSQL qualification exercises durable checkout replay, concurrent purchase rejection, lost-provider-response recovery, document ownership, event deduplication/current-state reconciliation and pending-payment capacity. A populated pre-billing fixture applies the canonical migration, verifies legacy settings and all previous migration receipts unchanged, and reapplies idempotently. A concurrent real public reactivation waits on the billing runtime's shared authority fence until the provider write finishes. See `qualification.md` for exact candidate and CI evidence.

Production acceptance still needs real Stripe sandbox checkout, card authentication/decline, supported SEPA asynchronous success/failure, portal add/remove/default methods, renewal/retry/cancellation, invoice/receipt authorization, quote expiry/replay and live-mode separation. Local HTTP stand-ins and database evidence establish no real provider transaction or deployment. Workspace work-type presets are researched separately in `docs/company-settings/research.md`; this billing increment does not silently apply those presets.

Invoices must retain the actual finalized legal identity and transaction facts. Ensure the selected Stripe/accounting/export arrangement satisfies the applicable financial retention and structured-invoice requirements. This increment is not an XRechnung/EN16931 generator or an assertion of all-country tax compliance.

## Primary references

- [Stripe versioning](https://docs.stripe.com/api/versioning)
- [Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [Customer portal capabilities and multi-product limits](https://docs.stripe.com/customer-management)
- [Portal sessions and focused flows](https://docs.stripe.com/api/customer_portal/sessions/create)
- [Invoice previews and matching proration dates](https://docs.stripe.com/api/invoices/create_preview)
- [Subscription updates and payment behavior](https://docs.stripe.com/api/subscriptions/update)
- [Webhooks, signatures, duplicate and unordered delivery](https://docs.stripe.com/webhooks)
- [Customer tax-ID limitations](https://docs.stripe.com/invoicing/customer/tax-ids)

import { classifyInventory } from "./registryClassification";
import { billingIds } from "./registryIdsBilling";

export const billingInventoryEntry = classifyInventory(billingIds, {
  owner: "merchant workspace billing",
  categories: [
    "provider customer/subscription references",
    "capacity and payment states",
    "operation fingerprints",
    "event receipts",
    "administrator audit references",
    "transient payer identity and payment documents",
  ],
  subjectRelation:
    "Billing parties may be legal persons, sole traders or identified finance contacts. Workspace actors and operation hashes do not establish general data-subject identity. Company employee counts and CRM prospect organizations are not payment authority.",
  purpose:
    "Merchant-operated workspace subscriptions, provider-hosted payment and billing management, owned invoice/receipt access, quoted seat changes and durable reconciliation. Synthetic test-support declarations do not contact a provider.",
  disclosure:
    "Current workspace administrators may access this installation's billing. Payer identity/address/tax data go to Stripe at explicit purchase/setup. Keep merchant keys, raw webhook bodies, signed portal/document URLs, card numbers and CVC out of stored audit evidence and generic subject exports. Operation hashes remain linkable evidence.",
  retention:
    "Local customer bindings, operation keys, event receipts and actor audit references are durable billing evidence. This increment does not schedule erasure or assert financial retention compliance. Provider documents, required finance retention, correction and backup treatment need the merchant's actual policy and separate subject scope.",
  externalEffects:
    "Authenticated HTTPS Stripe REST requests, current-state reconciliation, hosted checkout/customer portal, administrator browser API reads/commands and authorized document redirects. Payer drafts and stable retry commands are transient component state with protected capture classes. Deleting a controller removes an in-memory cancellation handle; HMAC/SHA-256 update identifiers are cryptographic calculations; execute:sql sets bounded transaction timeouts. No unsolicited email, CRM invoice issuance, provider erasure or real payment was executed by inventory classification.",
  erasureTask: "DPL-18 / #978",
});

import { classifyInventory } from "./registryClassification";
import { companyWorkIds } from "./registryIdsCompanyWork";

export const companyWorkInventoryEntry = classifyInventory(companyWorkIds, {
  owner: "workspace company identity, branding and operational work",
  categories: [
    "optional company and industry details",
    "executive, finance, procurement and role contacts",
    "legal, tax, banking and issuer preference records",
    "sanitized company icon and document logo bytes",
    "scoped provider proposals and VAT check responses",
    "workforce and CRM linked operational records",
    "preset configuration snapshots and actor-bound operation receipts",
  ],
  subjectRelation:
    "A company may be a legal person or sole trader; contacts, representatives, workforce owners and people in authored operational descriptions remain distinct subjects. Company administration, asset upload, a CRM reference, industry choice or provider match never establishes general subject identity or approved disclosure scope. Intended team size is descriptive and never payment quantity.",
  purpose:
    "Maintain optional company details, separate legal entities and explicitly reviewed payer/issuer preferences; sanitize owned branding; propose provider identity data only after selection; and support versioned workspace preferences, explicit preset installation, custom operational types and visible delivery records. Preset installation creates new native definitions and retains receipts without changing sales outcomes or granting permissions.",
  disclosure:
    "Current profile managers see profile details; current legal managers see private legal/payer records. Existing permissions.manage retains profile management. Private details, legal records, payer preferences and company replay responses use authenticated encryption derived from the existing installation key. The member shell receives only opaque workspace scope, display name, current icon URL and accent/foreground. Current approved assets are authenticated member-readable; unapproved/historical assets remain profile-manager previews. Never log bank, tax, contact, provider payload or key values. Work-item access separately checks current work capability, owner/group visibility and referenced CRM visibility. Original actor and live capability gate receipt recovery.",
  retention:
    "Company revisions, encrypted receipts, cancellation tombstones, asset metadata/bytes, legal records, work records and installation snapshots are durable. Clearing branding withdraws ordinary member access and retains historical bytes for managers. A storage request completing after its caller deadline may leave an unreferenced object; it cannot apply branding or grant access. Legal/work archive is not erasure; referenced payer/parent/schema records can block archive or undo. Undo removes only unchanged, unused owned additions, not subject data or provider copies. No automatic media reclamation, privacy export/rectification/restriction/erasure/retention adapter, key rotation or backup restore acceptance is introduced. Keep the installation key with backups; replacing or losing it without re-encryption makes private records unreadable.",
  externalEffects:
    "MinIO receives decoded, oriented, cropped, metadata-stripped PNG under server-derived company-assets/v1/<asset UUID>/<digest>.png immutable-purpose keys. Actual input/output bytes and decoded pixels are bounded, SVG/GIF/animation are rejected, and served objects are size/digest checked. GLEIF receives an explicit legal-name/country search; the fixed European Commission VIES service receives an explicit VAT country/number. Both responses are bounded and no submitted website is fetched. Signed GLEIF proposals bind actor/workspace and exact provider fields; manual edits reset checked claims. VAT validation is ephemeral identifier/time evidence, never tax treatment or universal company verification. Same-origin browser fetches carry commands/data; draft values and upload Files remain component memory with departure guards. The browser helper is inventoried for sessionStorage; private payload persistence is not required or authorized by classification. Opaque retry IDs are scoped by actor/workspace for recovery. Work search query text may contain authored personal data, so proxy and access-log retention is an installation boundary. The admin-only billing-copy read exposes only candidate checkout names, addresses, billing email and VAT, with a preferred entity ID; it does not expose unrelated contacts, bank or issuer records. Explicit selection copies to an in-memory first-checkout draft; confirmed checkout separately controls Stripe transmission. Map/Set updates, crypto update and local row editors are transient calculations, not additional stores. Work writers use PostgreSQL with atomic receipt/audit transactions. This inventory does not contact providers, operate billing, issue invoices, send mail or qualify physical deletion.",
  erasureTask: "DPL-15 / DPL-17 / DPL-18",
});

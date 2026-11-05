# Company settings and operational work

Warpdrive stores company identity, branding, legal records and delivery workflows per installation. The company display name identifies the workspace. A legal entity represents a registered business or sole trader. Payer preferences identify the party that should pay for Warpdrive. Issuer preferences describe how a legal entity may issue documents to its own customers in a future invoicing workflow. CRM organizations and people are the customers and prospects tracked by the workspace.

## Where to make changes

| Screen             | Route                            | Use it for                                                                                                                             |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Company details    | `/settings/company`              | Display name, website, industry, services, company size, operating countries, contact details, business hours and regional preferences |
| Workspace branding | `/settings/company/branding`     | Workspace icon, document logo, image fit and accent color                                                                              |
| Legal entities     | `/settings/company/legal`        | Registered identities, representatives, tax identifiers, payer preferences and future issuer preferences                               |
| Work profile       | `/settings/company/work-profile` | Work preferences, workflow starters, installation history and custom delivery configuration                                            |
| Work               | `/work`                          | Operational records, board and list, search, stage changes and archive                                                                 |
| Billing            | `/settings/billing`              | First subscription checkout, Stripe billing management and billing history when billing is configured                                  |

### Company details and legal identity

Save the display name first. Website, industry classification, employee range, operating countries and named contacts are optional. Record the scope and date of an employee estimate if they matter to your team. Expected Warpdrive users and employee range describe the company. Purchased capacity is managed through Billing. The existing workspace base currency is displayed separately from editable company and issuer preferences.

Use **Legal entities → Add legal entity** for each registered identity you need. Enter the legal name and country, then add its address, registry identifiers and contact roles as relevant. The form also supports a parent entity, several representatives and several tax identifiers. A parent must be an active legal entity, and the hierarchy must be acyclic. Archive preserves the record. Clear its payer selection or active child references before archiving it.

Use payer preferences to select a legal entity and enter billing, finance or procurement contacts and references. Open a legal entity's **Future issuer preferences** to store currency, language, terms, numbering series, payment instructions, bank details and electronic invoice preferences. The identity readiness indicator covers the registered address. Tax decisions, numbering allocation, electronic invoice conformance and actual document issuance require separate workflows.

### Branding

Choose a workspace icon and a separate document logo. Use the preview and available crop and fit controls, choose an accent and save the branding settings to apply the selected assets. The workspace can fall back to company initials when the icon is cleared. The shell uses the saved name, icon and accent where supported. The document logo is available for future issuer features.

The upload accepts static PNG, JPEG and WebP up to 2 MiB. The server checks the file signature and decoded pixel count, applies orientation and crop, removes metadata and encodes a PNG. The decoded image limit is 16 million pixels. Output fits within 512 × 512 for an icon or 2048 × 1024 for a logo, with a 2 MiB output limit. Use the authenticated asset route for previews. Saving an asset selection makes it available to workspace members. Clearing it withdraws ordinary member access and keeps the historical asset available to profile managers.

### Access and reauthentication

| Capability                                       | Scope                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Administrator                                    | All company and work controls, including preset preview, install and undo. Billing is administrator-only. |
| `company.profile.manage` or `permissions.manage` | Manage ordinary company details, branding and work preferences.                                           |
| `company.legal.manage`                           | Manage private legal and payer data and use the registry and VAT tools.                                   |
| `work.view`                                      | Open Work and read records within current visibility.                                                     |
| `work.create`                                    | Create work records. Assignment to another active user also requires `work.manage`.                       |
| `work.change`                                    | Edit, move, archive or restore visible records. Ownership and visibility changes are checked separately.  |
| `work.manage`                                    | Configure, archive or restore work types and stages and administer work ownership.                        |

Grant Work view together with create or change for team members who should use the Work screen. Same-origin writes require a live session and CSRF token. Company mutations, lookup and preset install or undo require fresh authentication. Presets install resource definitions. Grant work permissions separately through the existing permission sets.

## Set up a delivery workflow

Open **Work profile** and choose one or more work types, a primary type and the optional customer, delivery and goal preferences. Save your answers. The module checkboxes focus sidebar and shortcut links. The destination still checks its own permissions, and an empty selection uses the standard navigation.

| Starter                 | Sales pipeline                                                          | Delivery workflow and sample fields                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicle repair workshop | Inquiry → estimate preparation → estimate sent → customer authorization | Appointment → vehicle intake → diagnosis → repair → quality check → handover. Registration plate, VIN, mileage and reported fault.                                  |
| Design studio           | Inquiry → discovery → proposal → negotiation                            | Brief → research and concepts → client review → production → final approval → handoff. Deliverables, review round, asset location and usage rights notes.           |
| IT consulting           | Lead → discovery → scoping → proposal → procurement and security        | Kickoff → delivery → acceptance → handover. Scope, acceptance criteria, environment reference and estimated effort. Use environment references without credentials. |

1. Select a starter. Choose which parts to include from sales, delivery, optional sales deal fields and activity types. You can edit the proposed pipeline and delivery names.
2. Choose **Preview setup**. Review the planned creations, compatible reuse and conflicts. Resolve a conflict by choosing a different name or selection, or by reviewing the existing definition in its settings. Generate a fresh preview after a relevant configuration or profile change.
3. Choose **Confirm and install** and complete any reauthentication prompt. Installation history records the starter version and which resources were created or reused. The resulting sales pipeline and delivery type appear in their respective areas.
4. Use **Undo this installation** from the receipt when you need to reverse a setup. Undo removes unchanged, unused additions owned by that receipt. A referenced record, dependent configuration, reused addition in another active receipt or later edit can block the entire undo. The receipt and existing data are preserved when undo is blocked.

The standard CRM is usable without installing a starter. **Create custom workflow** lets a work manager set a name, ordered stages and typed record fields. Stage outcomes are in progress, completed and canceled. Fields support short or long text, number, date, selection and yes or no. Stable stage keys preserve stage identity across label and order edits. A used stage cannot be removed or change its outcome, and stored field values must remain valid after configuration edits.

### Run daily work

Open **Work** to create a repair job, design project, consulting engagement or custom delivery record. Choose its workflow and stage, enter a title, assign an active owner and add the relevant due date and operational fields. You can link a CRM organization, person and sales deal that you can currently access. The pickers list up to 250 visible options per reference type.

Use the board to see delivery stages or the list to scan records. Filter by workflow or stage, search titles and descriptions, and use **Load more** for the next page. Use the stage control to move a record. A completed delivery stage records operational completion. Sales won/lost is tracked separately on the linked deal.

Choose owner, a visibility group or everyone with Work access according to who needs the record. Owners, eligible team managers and current visibility-group members can see records under the applicable policy. Archive keeps records available through the archived filter. A work type with active records cannot be archived. Restore the workflow before restoring a record under it, and resolve an inactive owner before the record can be reactivated.

## Registry, VAT and first Checkout

A legal manager can explicitly search GLEIF by legal name with an optional country. Results are limited to active entities with issued LEI records. Review the selected result and its source before creating a legal entity. The saved provenance distinguishes provider-supplied fields from self-reported details. Use **Add legal entity** for businesses without an LEI or when lookup is unavailable.

The explicit VAT check sends the entered country and number to the European Commission VIES service. The result describes that identifier at the time checked. Retain your own evidence where a financial workflow requires it. Use the legal form for manual tax identifiers when the service is unavailable. VIES checks and GLEIF proposals have separate scope. Invoice tax treatment requires a transaction-specific determination.

Before the first Stripe customer is created, an administrator can open **Billing → Use company details**, select an active legal entity, review the displayed information and choose **Copy into billing form**. This copies its legal name and registered address, the configured billing email or issuer invoice email, and a matching VAT identifier into the editable Checkout draft. Review the actual payer and complete any required fields before submitting. The confirmed Checkout submission controls Stripe transmission. For an existing Stripe customer, use the Billing management flow and portal. The Stripe setup and merchant boundaries are in the [billing guide](../billing/README.md).

## Operations and data lifecycle

- Apply the journaled [0106 company/work-profile migration](../../drizzle/0106_company_work_profile.sql) through Warpdrive's normal migration entrypoint before serving the updated app. Self-managed development uses `bun run db:migrate`. The migration adds company, asset, work, installation and operation tables. The canonical settings record supplies the workspace display name. Use the standard backup and upgrade process for the database and object store.
- Preserve the installation's `TOKEN_ENCRYPTION_KEY` in protected secret storage and coordinate it with backups and restore access. Private company details, legal data, payer preferences and company operation responses use AES-GCM with a key derived from that installation secret. Losing or replacing the key without re-encryption makes these records unreadable. Key rotation and restore qualification are separate procedures.
- Company assets use the configured `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` and `MINIO_BUCKET`. Stored PNGs use server-assigned keys under `company-assets/v1/`. Storage requests have deadlines and asset reads check size and digest. A timed-out upload can leave unreferenced bytes if the storage write finishes late. Asset cleanup and retention require an operator process.
- Give legal, billing and operational records purpose-specific access. Operational records and their receipts are stored in PostgreSQL alongside company configuration. The member shell receives an opaque workspace scope, display name, current icon and accent colors. Keep private fields out of support captures and analytics. Work search terms can appear in request URLs, so apply the installation's access-log controls to them.
- Archive, clearing branding and undo have different effects on stored data. Legal and work archive retain rows. Clearing branding withdraws the live asset selection. Undo removes eligible installed definitions and records its result. Company/work records, assets, operation receipts and cancellation tombstones are durable. Subject-specific discovery, export, correction and erasure require the applicable privacy process. See the [privacy inventory](../privacy-data-inventory.md).
- An uncertain command can be retried with its original UUID while the draft is present. After navigation, use receipt recovery where available. If you cancel an unresolved command, wait for the server acknowledgment before starting a new one. The server serializes the cancellation with the original request and returns either the completed result or a durable cancellation. Private draft values stay in browser memory. Retry metadata supports recovery across navigation.

## Source design

The company and work APIs share live-session checks and durable operation identities. Each domain uses revisions to reject stale edits. Company details, branding, payer preferences and each legal entity have separate revisions. Work profile changes, installation previews, type configuration and record updates compare their relevant revision or configuration snapshot.

| API or data surface                                                     | Source entry point                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/api/company-profile` and its overview, asset and operation routes     | [Company runtime](../../src/features/company-profile/runtime.ts)       |
| `/api/company-lookup` for GLEIF proposals and VIES checks               | [Lookup runtime](../../src/features/company-profile/lookup/runtime.ts) |
| `/api/work-profile` and its overview, item, option and operation routes | [Work runtime](../../src/features/work-profile/runtime.ts)             |
| Preset configuration and operational records                            | [Work schema](../../src/features/work-profile/schema.ts)               |

Preset apply rebuilds the selected catalog preview against current configuration and writes the native definitions, operational configuration, receipt and audit in one transaction. Undo checks modification and dependencies, including saved filters and workflows that refer to installed stages. Work item reads enforce visibility and linked records are checked at write time. Work records have their own stage and type relationship alongside optional CRM links.

The original [company research and specification](research.md), [field catalog](fields.csv), [Mobbin workflow study](mobbin-research.md) and [reference index](mobbin-references.csv) document the design decisions and additional ideas. This guide describes the implemented routes and their operating boundaries.

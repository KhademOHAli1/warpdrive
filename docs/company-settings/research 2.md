# Warpdrive company Settings: information, collection and customization specification

Research and product proposal · 5 November 2026 · Germany/EU first

## 1. Decision and scope

Warpdrive should build an editable company and work profile in Settings, then collect finance information when a paid subscription or invoice workflow requires it. The profile should make the workspace useful and recognizable, support correct contracting and billing, and offer operational defaults suited to the customer's work. It should not make a new customer complete an extensive corporate questionnaire before using the CRM.

The confirmed commercial direction is a **workspace subscription with optional paid seats**, initially for Germany/EU, hosted and operated by Warpdrive. Stripe is selected for the follow-on billing backend. The inspected source currently describes a single-tenant, self-hosted MIT product without a per-seat application license fee. Paid subscriptions, customer billing and future invoicing are new scope; this report does not claim they are implemented, deployed or accepted. The owning fork and inspected Settings baseline are documented at [revision 3d50ce2](https://github.com/KhademOHAli1/warpdrive/tree/3d50ce207c66db1e5414d4128f55aa110fea809e). The [README at that revision](https://github.com/KhademOHAli1/warpdrive/blob/3d50ce207c66db1e5414d4128f55aa110fea809e/README.md) explains the existing product positioning.

The research separates source facts from proposed behavior. Legal requiredness depends on jurisdiction, party, transaction and document regime. Product requiredness depends on the action being attempted. “Valuable later” is a reason to design an extensible model, not a reason to collect all available data now.

The companion **Warpdrive-Company-Fields.csv** contains 88 logical fields, their purpose, tier, collection method, validation, authority, privacy, Settings section and delivery phase. It is a decision catalog, not a proposal for 88 onboarding inputs. Composite addresses, role contacts and source history intentionally remain logical field groups; engineering can normalize them without changing the user's mental model.

## 2. Separate the identities before designing the form

The company using Warpdrive is not necessarily the company paying its subscription, the legal seller on its invoices, or a CRM prospect. Keep these records distinct, with explicit links and convenient copy/review actions.

| Concept                              | Meaning and example                                                                         | Authority                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Workspace                            | Operational installation/team space, such as “Acme Studio”                                  | Workspace administrator                                   |
| Company profile                      | Trading identity and business context: website, industry, work types, size                  | Authorized company administrator                          |
| Legal entity                         | A registered company, sole trader or other legal business with jurisdiction and identifiers | Authorized legal/finance administrator; registry-assisted |
| Subscription account                 | Contract/plan granting access to Warpdrive; workspace fee and optional seats                | Warpdrive commercial system and confirmed contract        |
| Subscription payer / bill-to profile | Party and destination on Warpdrive's invoice; could be a parent company                     | Authorized billing administrator                          |
| Invoice issuer                       | Business using Warpdrive to invoice its own customers; possibly several per workspace       | Authorized finance administrator                          |
| CRM organization/customer            | Prospect or customer tracked inside the CRM                                                 | CRM record permissions and workflow                       |
| Work profile                         | How the customer operates, which templates and terms are useful                             | Administrator, with team scope possible later             |

A user account, workspace owner, CEO, authorized signatory and billing contact are also different roles. A director listed in a register is not automatically the person administering Warpdrive or approving a purchase. One legal entity may occupy several roles, but changing one role must not silently alter all others.

Provide “Use these company details” with a preview when creating the first payer or issuer. Thereafter maintain explicit associations and change behavior. If a group replaces the paying entity, require a payer-change workflow. If it creates a second invoice issuer, create a separate issuer profile. Multi-entity invoicing does not itself require introducing multitenancy into the current single-tenant application.

## 3. What to know, and when

### Tier A: minimum to make a workspace usable

At creation, obtain a workspace display name and an authenticated owner/admin. Generate stable internal IDs. Suggest timezone, locale and formatting from the environment, with explicit editing available. Defaults can keep those preferences from becoming blockers.

A company website, logo, employee count, industry and CEO should not be compulsory. New firms, sole traders, public bodies, associations, subsidiaries and client workspaces may not fit a conventional company directory record. The creation path needs a valid “No website,” manual-entry and “Set up later” route.

### Tier B: required for a specific financial or administrative action

Before billing a paid subscription, confirm the legal bill-to party, full billing address and country, invoice delivery destination, applicable tax information and chosen payment arrangement. Payment by agreed invoice terms should not require entering a card. Purchase references, electronic invoice addresses and VAT IDs are conditional; do not present them all as universal requirements.

Before the licensee issues invoices, confirm the selected seller, relevant identifiers, document disclosures, tax setup, payment instructions and defaults. An actual invoice also needs transaction-specific lines, dates, amounts and buyer data. Company Settings alone cannot establish invoice correctness.

Before enabling domain-controlled access or SSO, verify domain control. Before enabling scheduled automations, confirm their timezone. Before entering a jurisdiction-specific tax treatment, establish the relevant evidence. These action-specific checks should deep-link to Settings and return the user to the interrupted task.

### Tier C: good to know for immediate customization

Offer industry, work type, primary services, customer/business model, approximate company size and intended CRM team size when they visibly improve template suggestions. Ask for logo and color with a preview of the workspace benefit. Explain each optional question in terms of what it changes.

Employee count must remain separate from planned users, purchased seats, billable seats and active accounts. Ask for a range and scope:this legal entity or the whole group:and retain an as-of date. Do not infer a license entitlement from an enrichment estimate or automatically bill more because headcount increased.

### Tier D: valuable for a defined later feature

Parent-company relationships, operating markets, fiscal-year start, executive sponsor, security/privacy contacts, revenue band, service catalog, external accounting IDs and custom operational entities can support specific later features. Add or request them at that moment. Exact revenue, executive biographies, home addresses, birthdates, identity documents and beneficial-owner details do not belong in a default CRM profile questionnaire.

CEO is optional firmographic context. If a document needs legally relevant representatives, collect those people and roles through the legal entity's jurisdiction-specific document settings. Support multiple representatives rather than forcing the answer into a single “CEO” string.

## 4. Industry is not the work profile

Industry describes the economic sector. Work type describes the activities and delivery model the customer wants Warpdrive to support. Modules describe available software capabilities. Templates supply proposed configuration. These four concepts should be independently editable.

A vehicle workshop may sell services and parts, handle fleet accounts and perform repairs. A design studio may run projects, retainers and product sales. An IT consultancy may combine implementation projects, recurring support and advisory work. An industry label alone cannot determine the correct workflow, and a company may select several work types.

Use friendly industry categories with optional secondary tags. Preserve formal classification scheme/version separately if imported: Eurostat identifies NACE Rev. 2.1 as the current revision used for European statistics from 2025; official company records can expose other schemes such as UK SIC. Do not treat those codes as interchangeable or force customers to understand them during setup. [Eurostat NACE overview](https://ec.europa.eu/eurostat/web/nace/)

Recommended work-profile questions:

1. **What kind of work do you manage?** Multi-select: vehicle workshop/repair, creative/design projects, IT consulting/implementation, professional services, recurring support, product sales, other. Permit a custom label and skipping.
2. **Who are your customers?** Businesses, consumers, public bodies, or a mix.
3. **How do you deliver work?** Appointments/work orders, scoped projects, ongoing retainers/support, product orders, or a combination.
4. **What would you like to set up?** Pipelines, activities, service/project fields, document templates, reminders, or start with the standard workspace.

Selecting answers creates a **reviewable proposal**. The user sees the proposed additions, terms, required modules and effects before applying them. The standard generic configuration remains available. Custom templates should build on the same supported primitives rather than requiring a different product edition for every industry.

### Example configuration proposals

| Area                         | Vehicle workshop                                                                                      | Design studio                                                                      | IT consultancy                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Useful terms                 | Customer, vehicle, estimate, work order, handover                                                     | Client, brief, proposal, project, approval                                         | Account, opportunity, engagement, service agreement                                          |
| Sales pipeline               | Inquiry → estimate preparation → estimate sent → authorization → won/lost                             | Inquiry → discovery → proposal → negotiation → won/lost                            | Lead → discovery → technical scoping → proposal → procurement/security → won/lost            |
| Post-sale delivery           | Appointment → intake → diagnosis → repair → quality check → handover                                  | Brief → research/concepts → review → production → final approval → handoff         | Kickoff → delivery milestones → acceptance → handover; separate support lifecycle where used |
| Useful linked records        | Vehicle and service history linked to customer, appointment and work order                            | Project, brief, deliverables and approvals linked to client/deal                   | Engagement, statement of work, systems/environment and support agreement linked to account   |
| Suggested operational fields | Registration/VIN if needed, make/model, mileage, reported problem, authorization, promised completion | Deliverables, milestones, revision allowance, rights/usage scope, approval contact | Scope, milestones, project owner, environment/access owner, SLA/retainer terms               |
| Activity defaults            | Vehicle intake, estimate follow-up, collection appointment                                            | Discovery call, concept review, approval reminder                                  | Discovery, technical workshop, procurement follow-up, acceptance review                      |
| Automation suggestions       | Remind staff when approval is overdue; notify responsible person before promised handover             | Remind project owner before milestone; request internal review before delivery     | Remind engagement owner before acceptance/renewal; flag support response deadlines           |
| Document defaults            | Estimate/work-order reference and approved-service lines                                              | Proposal/milestone references and agreed deliverables                              | Statement-of-work/contract reference and agreed billing milestones                           |

These are starting proposals, not claims about every business in those sectors. Vehicle identifiers, project approval contacts and IT environment records belong to operational records, not company Settings. Collect them only where used and assign suitable permissions. Do not store customer credentials in free-text company fields.

Keep sales stages distinct from delivery statuses. Marking a deal won should not itself assert that a repair, design project or implementation is completed or invoiced. Reminders can be offered early; customer-facing messages, financial documents and billing actions need explicit configuration and review.

Applying a work profile must preserve current data. Show a diff: new pipelines, activity types, fields, terminology overrides and proposed automations. Do not delete existing fields or rewrite stages automatically. Allow selective application, undo of reversible additions, and conflict handling. Record the template version and local changes. Changing the work-type answer later should refresh suggestions, not reset the workspace. Per-team work profiles are a useful later extension because sales, service and project teams may operate differently.

## 5. German/EU finance facts that change the design

### Ordinary invoices and conditional party information

For ordinary full German VAT invoices, §14(4) UStG requires supplier and recipient names/addresses, a supplier tax number or VAT ID, issue date, unique invoice number, service/goods information and supply date, consideration and applicable tax/exemption information. Several items are transaction data rather than company-profile fields. This general list does not make logo, headcount, industry, CEO or every buyer's domestic tax number compulsory. Simplified and special regimes need separate rules. [§14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html)

Certain cross-border transactions require both VAT IDs and special wording. Customer tax identifiers should therefore be typed by country and identifier type, not stored in one ambiguous text field. [§14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html), [European Commission invoicing guidance](https://taxation-customs.ec.europa.eu/taxation/vat/vat-businesses/invoicing_en)

Small-business invoices have a specific minimum-information regime under §34a UStDV, including permitted alternative issuer identifiers and the exemption statement. “No VAT ID” must not automatically mean “VAT exempt.” [§34a UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__34a.html)

For applicable German GmbH business letters, §35a identifies legal form, seat, register information and managing-director disclosures, with defined qualifications. This supports conditional legal-representative document fields, not a universal CEO requirement for all customers. [§35a GmbHG](https://www.gesetze-im-internet.de/gmbhg/__35a.html)

### E-invoicing as of the research date

Applicable domestic German B2B rules have transition periods: other invoices remain generally permitted through 2026; the relevant prior-year-turnover threshold of no more than €800,000 supports an extension through 2027, alongside specified EDI arrangements. The general transition ends for 2028. Conditions and exceptions matter, and transitional PDFs require the relevant consent. [§27(38) UStG](https://www.gesetze-im-internet.de/ustg_1980/__27.html)

A plain PDF is not the structured E-Rechnung described by the newer rules. German businesses have needed the ability to receive E-Rechnungen since 2025; an email inbox can serve as a receiving channel. Suitable XRechnung/ZUGFeRD profiles are examples of structured formats. [BMF e-invoice FAQ](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)

The BMF's 15 October 2026 letter addresses mapping statutory content to structured business terms, corrections and the distinction between technical/business-rule errors and tax-law content errors. The product must validate the generated structured document and actual content, not just collect a “format” preference. [BMF letter of 15 October 2026](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2026-10-15-obligatorische-elektronische-rechnung.pdf?__blob=publicationFile&v=1)

For federal German public-sector invoices, additional items include the buyer's Leitweg-ID, payment terms, bank details and issuer email, with procurement references where provided. A supplier obtains the recipient's Leitweg-ID; this is not a reason to require every licensee to enter “your Leitweg-ID.” Buyer references and delivery routing often belong to customer/order/invoice records. [Federal invoice requirements](https://www.e-rechnung-bund.de/faq/e-rechnung/), [Leitweg-ID guidance](https://www.e-rechnung-bund.de/faq/leitweg-id/)

Prefer supported structured issuance over collecting exact company revenue merely to exploit a transition. If transition eligibility matters, ask a targeted eligibility confirmation with appropriate evidence. Rules should evaluate issuer, buyer, date, supply, tax regime and output profile together.

### Validation, history and money states

VIES checks intra-EU VAT registration using national systems. An invalid result may reflect nonexistent, not-activated or unfinished registration; outage is a different result. Retain evidence and date, and provide correction/review instead of treating all failures as user error. [Your Europe VIES guidance](https://europa.eu/youreurope/business/finance-and-tax/vat/check-vat-number-vies/index_en.htm)

Stripe's current documentation illustrates an important limitation: format checking and asynchronous authority validation differ; EU/GB validity does not establish name/address matching. IDs can appear on invoices even when invalid, and verification does not continuously refresh. If Stripe is selected, tax policy needs explicit handling beyond provider UI states. [Stripe tax-ID documentation](https://docs.stripe.com/tax/invoicing/tax-ids)

Issued documents need snapshots of the relevant identities, identifiers, tax calculation, payment instructions, template and transaction data. Profile changes apply prospectively and should recheck affected drafts. Stripe's invoice-finalization lifecycle exemplifies immutable customer snapshots. [Stripe invoice lifecycle](https://docs.stripe.com/invoicing/integration/workflow-transitions)

The general German VAT invoice retention period is eight years, with statutory qualifications. That does not justify retaining every optional company/executive profile attribute for eight years. [§14b UStG](https://www.gesetze-im-internet.de/ustg_1980/__14b.html)

Keep profile saved, ID checked, invoice issued, payment confirmed, funds available and payout arrived separate. Settlement timing, payout schedule and receiving-bank availability are different concepts. A faster payout schedule does not itself make pending money available sooner. [Stripe payout documentation](https://docs.stripe.com/payouts)

## 6. How to gather the information

### Manual first, assisted where beneficial

Customer confirmation should remain available for every required field. Start with a reliable manual form, country-sensitive addresses, upload/preview for logos and explicit reuse of existing details. Then add lookup adapters where they save measurable effort. An unavailable provider must not prevent a valid customer from entering its own details.

Use a name plus country/registration-number search for legal entities, and website/domain search for branding. Display distinguishing location, registry number and status before selection. A domain can identify a brand candidate while still leaving the correct legal entity ambiguous. Shared domains, parent brands, franchises, agencies and public email providers need explicit handling.

| Source                                | Best use                                                                   | Tradeoff and recommended treatment                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Customer/authorized administrator     | Preferences, actual payer, work type, role contacts and confirmed identity | Lowest integration complexity; explain why fields matter and reuse prior entries                           |
| Official jurisdictional register      | Legal name, identifier, status and registered office                       | Strong matching input; coverage is jurisdiction-specific and automation access must be established         |
| Companies House API                   | UK entity lookup and SIC data                                              | Official machine-readable source for supported entities; do not assume all countries offer equivalent APIs |
| VIES/national tax systems             | Applicable tax-registration check                                          | Validation rather than a general company directory; distinguish unavailable and mismatch                   |
| OpenCorporates                        | Cross-jurisdiction discovery/reconciliation                                | API licensing, coverage, upstream provenance and freshness need review                                     |
| GLEIF                                 | LEI-based matching and recorded parent relations                           | Useful where an LEI exists; not universal company coverage or a required onboarding identifier             |
| Brandfetch or similar brand provider  | Logo/color and brand/domain suggestions                                    | Convenience and visual coverage; not legal-entity or signing-authority verification                        |
| Company website/brand kit             | Current self-published branding and business description                   | Namesake/brand/entity ambiguity; review source and rights; no invented missing values                      |
| Authorized accounting/ERP integration | Existing entity, tax, payer and external IDs                               | Mapping and conflict preview required; scope the connection and choose field ownership                     |

Relevant official interfaces: [German joint register information](https://www.handelsregister.de/rp_web/div/info-lang/EN_Registerportal.pdf), [Companies House API/schema](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companyprofile?v=latest), [OpenCorporates API](https://api.opencorporates.com/documentation/API-Reference), [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api), [Brandfetch developer overview](https://brandfetch.com/developers).

No provider is selected by this report. Evaluate vendors against entity/brand coverage in launch countries, precision on subsidiaries and sole traders, provenance, correction mechanisms, cache/license rights, permitted asset use, data transfers, cost per successful accepted result, quotas and outage behavior. Public availability does not itself establish unrestricted commercial API access. [OpenCorporates current self-service terms](https://opencorporates.com/legal-information/self-service-api-terms-of-service/)

The current Warpdrive source already has enrichment proposal/disagreement handling and several record-enrichment providers. Reuse those review semantics and domain normalization consciously. Do not promote prospect-enrichment data to billing truth without confirmation, or trigger paid lookups invisibly. Disclose the fields sent to a provider and potential credit use. HubSpot's documented enrichment also illustrates explicit enablement and selectable individual properties. [HubSpot enrichment documentation](https://knowledge.hubspot.com/records/get-started-with-data-enrichment)

Logo acquisition should support a user upload, provider suggestion, removal and initials fallback. Show fit/crop and light/dark previews; retain an explicit invoice-branding choice. A workspace icon should not automatically become every issuer's document logo. Store safe processed assets and applicable provenance. Color suggestions need accessible contrast before applying them to the product.

## 7. Settings information architecture and collection flows

Preserve the existing permission-aware Settings shell and its Personal, Workspace, Sales, Email, and Data and integrations groups. The current `/settings/company` page already handles company name and fixed base currency. Extend this destination rather than creating a competing company editor elsewhere. Preserve existing semantic tokens, controls, save/error behavior and German, English and Farsi/RTL support.

Recommended destinations:

| Placement                              | Content                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Workspace → Workspace details          | Display name, company profile, website, optional size/industry and organization defaults         |
| Workspace details → Branding           | Workspace icon, brand color, previews and document-brand reuse choices                           |
| Workspace details → Work profile       | Work types, delivery/customer models, templates, terminology and reviewed module suggestions     |
| Workspace → Legal entities             | Operating businesses, registrations, representatives and linked issuer profiles                  |
| Billing → Warpdrive subscription       | Plan, interval, entitlements/seats, renewal, contract history and controlled plan changes        |
| Billing → Billing details              | Subscription payer, tax information, invoice contacts, procurement and delivery details          |
| Billing → Payment methods and invoices | Hosted payment management where appropriate; own subscription invoice history                    |
| Invoicing → Issuers and defaults       | The licensee's outgoing invoice identities, payment instructions, templates, numbering and terms |
| Data and integrations → Enrichment     | Provider configuration, consent/permission controls where relevant, cost and refresh behavior    |

Billing and Invoicing are proposed navigation groups. Introduce them when supported, not as empty promises. If the first release uses fewer pages, preserve the conceptual separation through clearly titled sections. Keep personal regional/appearance settings distinct from organization defaults and shared branding.

### Four core collection flows

**A. Create and personalize:** create workspace → optional company lookup/manual entry → confirm selected details → optional branding → select work types → review setup proposal → continue. Every optional step can be skipped. Settings remains the canonical editor.

**B. Upgrade:** select workspace plan and any seat option → confirm bill-to identity/address → supply applicable tax/procurement/delivery details → review price, tax, renewal and effect → payment/contract acceptance → authoritative result. Existing company details may be reused after review. Never turn a generic profile-save success into proof of subscription activation.

**C. First invoice:** choose/create issuer → complete missing relevant legal/tax/document details → choose customer/transaction and required references → preview → validate selected output → explicit finalization. Return to the draft after Settings completion. Avoid asking optional firmographics during this task.

**D. Maintain information:** edit an individual section → show affected uses and drafts → validate → save → acknowledge persistence → expose source/check status separately. For enrichment changes show old/new/source/date and apply selected proposals. For issuer/payer replacements use explicit reassignment rather than a cosmetic rename.

GOV.UK's question protocol supports asking only questions with a defined use, audience, accuracy and maintenance plan. Address lookup must include a manual path and appropriate geographic coverage. These are transferable design principles, not a requirement to adopt government visual styling. [Structuring forms](https://www.gov.uk/service-manual/design/form-structure), [Address pattern](https://design-system.service.gov.uk/patterns/addresses/)

Accessibility should include persistent labels, appropriate autocomplete, keyboard-operable lookup/review, text errors and useful correction suggestions, with review or other error prevention for consequential submissions. Reuse prior information where appropriate rather than demanding re-entry. WCAG's input-purpose criterion has a specific scope for information about the user; it is not a blanket claim about every third-party company field. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 8. Readiness, permissions and trust

Use several small readiness checks rather than a single profile-completeness score:

- **Workspace ready:** name, owner and usable defaults.
- **Personalization available:** optional work/brand inputs; never a hard access gate.
- **Subscription ready:** required bill-to, commercial, tax and payment arrangement for the selected purchase.
- **Issuer ready:** relevant entity/document/tax configuration for a selected issuer and regime.
- **Invoice ready:** issuer plus actual buyer/transaction/output requirements for this document.
- **Domain feature ready:** domain control and security configuration for that feature.

States should include incomplete, ready, needs review and unable to check. A temporary lookup outage should not assert invalidity. Each blocker must identify the missing fact, why this action requires it, who can fix it and a direct route. Optional information can show benefits without a red warning or pressure to disclose it.

Store source type, source record/URL, retrieved time, effective/as-of date when known, proposed value, confirmed value, confirmation actor/time and specific verification results. Use clear labels such as Entered, Suggested, Confirmed by your team, Checked against VIES, Needs review and Could not check. Do not label an entire company verified after checking one identifier.

Never silently overwrite confirmed legal names, tax IDs, tax treatment, issuer, payer, bank details or signatories with enrichment. Show a diff for provider refreshes. Ordinary reversible appearance edits need suitable undo; legal/finance changes need durable history and impact rules. Preserve Unicode/local-script names and original values separately from normalized search keys.

The current company settings action uses server-side authorization, CSRF controls and auditing. Preserve those controls. Initially the existing administrator capability may cover new settings, but financial functionality should define explicit capabilities: company/branding edit, work-profile/template apply, legal-entity edit, subscription billing manage, issuer/tax manage, invoice issue, bank change and domain/security manage. UI hiding alone is insufficient.

General members may see useful organization identity, while finance data and named legal/security contacts need narrower visibility. A billing-only recipient need not be a licensed CRM member. Ownership transfer, payer reassignment and bank changes should record the responsible actor and relevant authentication/confirmation. Avoid embedding private finance data in broadly visible logs or ordinary company cards.

For privacy, corporate facts and natural-person data differ. Named employees, business email addresses/phone numbers and some sole-trader information can be personal data. [European Commission company-data explanation](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/application-regulation/do-data-protection-rules-apply-data-about-company_en)

Identify a concrete purpose and lawful basis for personal data; minimize, maintain accuracy and set retention. Direct collection and indirect/public-source collection have different transparency provisions under Articles 13/14. Public availability and optional UI fields do not themselves establish a lawful basis. Keep executive enrichment off by default, collect role contacts for actual functions and handle correction/removal. Do not use a vague future sales possibility as justification for broad collection. [GDPR Articles 5, 6, 13 and 14](https://eur-lex.europa.eu/eli/reg/2016/679), [EDPB lawful-processing guidance](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en)

## 9. Delivery plan and acceptance criteria

### Phase 1: a reliable editable foundation

Add manual company profile, logo upload/preview, work profile and standard/custom template selection; preserve current Settings behavior. Establish distinct legal-entity, payer, subscription and issuer concepts. Implement the confirmed workspace subscription direction and optional seats through explicit commercial authority; Stripe activation and provider acceptance remain separate decisions. Country-aware finance forms and conditional readiness come before broad automated enrichment.

### Phase 2: assisted acquisition and document workflows

Add a launch-jurisdiction registry adapter, VAT validation with unavailable state, optional brand suggestions and approved accounting import. Add invoice issuer readiness, supported output validation, immutable finalized artifacts and correction workflows appropriate to the launch regime. Introduce granular financial permissions and provider synchronization monitoring.

### Phase 3: broader operational personalization

Add multi-entity issuance, more registry jurisdictions, approved refresh proposals, per-team work profiles, reusable organization-owned templates and richer operational modules. Template application should remain reviewable and versioned. Measure whether customization improves real task completion before expanding the questionnaire.

### Acceptance criteria

1. A new workspace is usable without website, logo, size, industry or CEO.
2. The field catalog distinguishes required-at-action, optional, conditional and system-derived values; backend validation matches the selected action.
3. Company industry, work types, modules and templates are separate, editable concepts; multiple work types are supported.
4. A mechanic/workshop, design studio and IT consultancy can each review relevant setup proposals without losing existing records or configuration.
5. Sales pipelines and post-sale delivery states remain distinct. Template application does not automatically issue documents, send customer messages or incur charges.
6. Legal entity, subscription payer and invoice issuer can differ. Reuse is explicit and all issued documents preserve their relevant historical snapshot.
7. Employee count never determines charges. Seat entitlements use commercial/subscription authority and show the effect before confirmation.
8. Company/provider lookup supports multiple matches, no match, throttling/outage and manual entry; suggested values show source/date and require appropriate review.
9. Valid, invalid, mismatched, pending and unavailable checks are distinguishable; saved does not mean verified, activated, paid or settled.
10. Required address/contact/tax fields are country/context aware and accessible, including keyboard correction and preserved drafts.
11. Only authorized roles can change consequential financial/security data; server-side controls and useful audit events cover each change.
12. Current German/EU invoice rules, selected format profiles and provider behavior are verified during implementation; research and source completion are not runtime acceptance.

Track time to usable workspace, task-specific setup completion/drop-off, template acceptance/undo, enrichment corrections/false matches, invoice readiness errors, provider outages and billing-contact delivery failures. Do not optimize a blanket completeness percentage by making low-value fields mandatory.

## 10. Open decisions

The commercial model and initial geography are confirmed. Remaining choices are: Warpdrive's actual selling legal entity and merchant-of-record/direct arrangement; supported B2B/B2C/public-sector scope; included seats and optional-seat pricing; native invoicing versus accounting delegation; supported issuer count; tax validation and e-invoice delivery coverage; authoritative numbering/finalization system; precise supported output profiles; retention/export behavior; and which work-type modules are available in the initial release.

Decide how enterprise contracts, purchase orders, group payers and negotiated invoice terms interact with self-service upgrades. Decide whether custom templates are workspace-owned only or shareable, and whether terminology changes are organization-wide or team-specific. These choices should not delay manual profile improvements, but they must not be hidden behind assumptions that later alter customer bills or records.

## 11. Mobbin evidence annex

Fresh authenticated visual research inspected selected frames in **eight Mobbin flows across Attio, Remote and Stripe**. The separate **Warpdrive-Mobbin-Research.md** annex records exact links, inspected frames, visible fields, state transitions, adaptations and gaps; **Warpdrive-Mobbin-References.csv** provides the compact register.

| Need                                                            | Directly reviewed reference                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Company name, workspace logo and billing country                | [Attio onboarding](https://mobbin.com/flows/33785144-9ef2-4b1a-8a1c-27c13ce0e1c6)             |
| Legal entity, address, VAT and finance notification contacts    | [Remote company information](https://mobbin.com/flows/c741bdb2-3fed-4de2-a9d0-eaf0fabe6ad6)   |
| Company size and primary/secondary interests                    | [Remote onboarding](https://mobbin.com/flows/9e8a5865-071a-4b95-babd-31ce4f30f027)            |
| Searchable business-activity categories                         | [Stripe business verification](https://mobbin.com/flows/256fc9e4-24f7-4a48-bebc-7615f033a230) |
| Payment method setup, masked primary method and invoice history | [Attio payment methods](https://mobbin.com/flows/8606cb6a-a185-4b56-aa0b-742b02779b8f)        |
| Icon/logo/colors with affected-surface previews                 | [Stripe business settings](https://mobbin.com/flows/fa6bf524-9234-4ea2-b864-d0fadfaeb125)     |
| Invoice template fields and document preview                    | [Stripe invoice templates](https://mobbin.com/flows/4cdb55ff-a2dd-409c-87ec-5856ff903fed)     |
| Separation of general workspace details and billing             | [Attio workspace settings](https://mobbin.com/flows/fccf2204-f315-46ff-9373-a816681c1616)     |

The research did not review complete EU VAT mismatch/outage, register disambiguation or structured e-invoice setup flows. Payment-provider verification screens supply collection patterns; their KYC questions are not Warpdrive customer requirements. Mobbin captures were inspected, not executed as live source-product transactions.

## 12. Source appendix and evidence limits

Primary sources are linked beside the claims they support. Core product evidence is the owning fork at revision 3d50ce2, including its singleton company Settings, separate CRM organization model, permission-aware navigation, reviewable enrichment and planned integration catalog. That audit is source context, not visual/runtime or legal acceptance. Recheck the owning source immediately before changes because other Warpdrive work is active.

Additional implementation references: [Companies House overview](https://developer.company-information.service.gov.uk/), [Companies House search guidance](https://www.gov.uk/guidance/searching-the-companies-house-register), [Stripe customer portal configuration](https://docs.stripe.com/customer-management/configure-portal), [Google Workspace DNS verification pattern](https://knowledge.workspace.google.com/admin/domains/verify-your-domain-with-a-txt-record), [PCI SSC CVC storage guidance](https://www.pcisecuritystandards.org/faqs/1280/).

Source coverage is strongest for Germany/EU invoice requirements and the named providers' documented behavior. It does not establish a universal company-information mandate, all-country invoice compliance, a vendor selection, a deployed billing system or customer authorization to process unrelated data. The field catalog and operational templates are product recommendations built from those constraints and the user's confirmed direction.

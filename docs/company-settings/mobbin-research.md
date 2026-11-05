# Mobbin research: company information, personalization, billing and invoicing

Accessed 5 November 2026, Europe/Berlin. Fresh authenticated Mobbin visual research for this task, across Attio, Remote and Stripe. Eight linked flows; selected frames reviewed, not eight fully executed live-product workflows. MB01 was inspected by the parent agent in the same task; MB02–08 were inspected by this researcher. The exact frame selections are in `mobbin-references.csv`.

## Method and evidence boundary

No usable Mobbin plugin was available. Research used the documented CUA browser API in one new named Chrome research tab, leaving existing user and other-task tabs untouched. Mobbin screens are captured images: navigating the viewer did not create a company, save a payment method, upload a logo, accept terms, issue/download an invoice, or execute any source-product transaction. No Save/Copy/collection/AI Assistant actions were used. No source-product assets were exported. The browser task ended with the required completion summary.

Each reviewed image was visually inspected in the viewer. A title or thumbnail alone is not counted as a reviewed workflow. This is visual/interaction-pattern evidence, not evidence of a product's present-day validation, billing rules, server behavior, legal compliance or accessibility. The displayed reference images identify a 1512×945 web capture; they do not establish mobile, German or Farsi behavior.

## Reference register

### MB01 : Attio: workspace settings

Link: <https://mobbin.com/flows/fccf2204-f315-46ff-9373-a816681c1616>.

Reviewed by parent in this task: frames **2, 6 and 7 of 18**, not the full flow.

Observed: General workspace settings includes workspace name and logo upload/remove. Billing has plan/usage, billing email, company name/address/EIN, update-billing-details action, payment methods and an invoice-history table with download actions.

Adaptation: place **Company profile**, **Branding**, **Warpdrive billing** and **Your invoicing** under the existing workspace Settings group. Keep workspace display name distinct from legal invoice name even if initially prefilled from one another. Billing contact and payment instruments have their own focused editing paths.

Limit: EIN is an example from a captured jurisdiction, not a universal required field or an EU VAT substitute. No full address-edit validation/error flow was inspected here.

### MB02 : Attio: onboarding

Link: <https://mobbin.com/flows/33785144-9ef2-4b1a-8a1c-27c13ce0e1c6>.

Selected frames **1, 5, 8, 10, 12, 14 and 15 of 19** were visually inspected. The company-relevant core is 8/10.

Observed:

- Frame 8: **Create your workspace** asks for company logo, company name, workspace handle and billing country; the right side previews the workspace identity. Logo guidance states PNG/JPEG/GIF below 10 MB and recommends 400×400 px. Those are Attio's captured limits, not a proposed Warpdrive contract.
- Frame 10: the billing-country menu is searchable and contains specific countries, rather than free-text country values.
- Frame 12: acquisition-source chips are explicitly optional with Skip.
- Frame 14: choosing AI reveals a follow-up engine question. This is an observed conditional-question pattern, not a recommendation to ask acquisition questions.
- Frame 15: connecting Google/Microsoft is presented with a benefit and an alternative manual contact-creation path.

Adaptation: a compact identity setup should request workspace/company display name, business website and optional logo; use country to reveal the right address and tax fields later. Provide a manual path and a skip for nonblocking enrichment. Show a meaningful workspace preview rather than asking for customization without explaining the result.

Do not copy: requiring billing country for every free/self-hosted installation, copying Attio's exact upload formats/limits, or making marketing-attribution questions part of company-profile completeness. No industry/headcount question was seen in these selected Attio frames.

### MB03 : Attio: adding a payment method

Link: <https://mobbin.com/flows/8606cb6a-a185-4b56-aa0b-742b02779b8f>.

**All four frames** visually inspected (frame 2 is visible as the adjacent full modal in the opening view; frames 3/4 were selected explicitly).

Observed:

1. Billing overview separates plan/billing period, seats and workflow credits from billing details. Add payment method is beside the payment-method section.
2. A focused modal asks for full name and a compact card control with number/expiry/CVC; Cancel and explicit Add payment method.
3. Filled modal precedes submission.
4. Billing overview now shows a **masked Visa**, expiry and **Primary** status, with the add action still available. The invoice list shows reference, amount including tax, status, date and download icon. The captured example still lists an EIN as not provided.

Adaptation: collect payment data at payment setup using the chosen payment provider's hosted/tokenized controls; return a masked method summary and clear default state. Keep billing-profile editing and payment-method editing distinct. The stable Settings page should also offer invoice history/download. The provider-storage recommendation is Warpdrive design guidance, not proof of the captured product's implementation.

Gaps: no declined-card, required authentication, expired card, remove/default-switch or network-failure state was included. Those must be designed and tested separately. Adding a method is not a purchase, invoice payment or subscription activation by itself.

### MB04 : Remote: company information

Link: <https://mobbin.com/flows/c741bdb2-3fed-4de2-a9d0-eaf0fabe6ad6>.

**All three frames** visually inspected across selected/adjacent views.

Observed:

- Company settings index groups Company details, Organizational structure, Pricing & Plans, Payroll & Payments, Admins & Permissions, Integrations, Security and Contractor invoices.
- Company information displays **Your default entity**: legal entity name, country, address, address line 2, city, state, postal code, VAT number and phone. A Manage default entity action is separate from the summary.
- An entity sidebar makes default-entity scope and status clear and distinguishes country, team members, active services and a stable integration identity.
- Terms/accepted-on/accepted-by and privacy notice are separate sections. A later section has notification contacts and **billing email**, rather than assuming the account owner is the only finance recipient.

Adaptation: make **legal entity and its purpose** visible. Use structured addresses, distinguish default entity from display identity, and support role-based operational/billing contacts. If multiple seller entities are added later, show the selected entity before editing or producing an invoice. Keep terms-acceptance evidence system-generated and separately versioned; do not ask users to enter it as profile text.

Gaps: these images are read summaries, not the full default-entity edit/validation process. The HR product's organizational hierarchy does not imply Warpdrive needs departments/cost centers to issue its first license invoice.

### MB05 : Remote: employer onboarding

Link: <https://mobbin.com/flows/9e8a5865-071a-4b95-babd-31ce4f30f027>.

Selected frames **1, 7, 10, 11, 12 and 15 of 19** visually inspected.

Observed:

- Basic company step asks for **legal company name**, **country** and **company size**. It explains that details should match legal documents.
- Country picker lists specific countries; the completed sample has **2–9 employees**. The full size-range menu was not captured/read, so do not invent its options.
- Required terms/authority acceptance and optional marketing-updates checkbox are separate.
- Product-interest step uses three cards: **Employer of Record**, **Contractor Management** and **Payroll**. Multiple selections are shown. First choice is marked **top interest**. Copy explicitly says the choice personalizes the experience and does not commit to purchases.

Adaptation for Warpdrive's industry-aware workspace: ask separately **What kind of business do you run?** and **What work will you manage here?**. Let a mechanic choose repair bookings/job follow-up, a design studio choose projects/approvals/retainers, and an IT consultancy choose sales/projects/service renewals. A primary workflow plus optional secondary workflows gives better defaults than industry alone. Explain the visible consequence: recommended pipeline, field groups and templates, all reviewable before applying. These mechanic/design/IT choices and preview/apply behavior are Warpdrive proposals, not Remote screens.

Use employee bands for optional tailoring and keep actual licensed seats separate. Do not transfer the HR product's decision to require company size into a claim that size is legally necessary for CRM billing.

### MB06 : Stripe: business settings

Link: <https://mobbin.com/flows/fa6bf524-9234-4ea2-b864-d0fadfaeb125>.

Selected frames **1, 4, 7, 8 and 9 of 11** visually inspected, with adjacent summary frames visible.

Observed:

- Business settings index separates **Business**, **Profile**, **Your plans**, **Compliance/documents**, **Team/security** and product-specific Billing/Payments.
- Business tabs distinguish Account details, Account status, Business details, External payout accounts, Tax details, Branding, Custom domains and Customer emails.
- Account-details adjacent image has account name/ID, business address, phone-verification status and timezone.
- Business-representative state (4) explains what needs review and shows a progress/status panel. This is payment-provider/KYC context; it is not evidence that CRM customers must submit representative identity.
- Tax-details frame (7) is visibly jurisdiction-specific (MY TIN/SST and entity type), demonstrating conditional regional information rather than a universal VAT field.
- Branding frame (8) separates **icon**, **logo**, preferred logo/icon, **brand color** and **accent color**. Preview tabs include Email receipts, Checkout & Payment Links, Customer portal, Invoice and Identity. A hosted/embedded preview option and device toggle are visible. Frame 9 shows a different customer-facing preview.

Adaptation: keep legal/tax data separate from brand assets and user preferences. Provide distinct square workspace icon and document logo when needed; preview their real placement. Show proposed brand colors with accessible fallback tokens so company branding does not override readable focus, error or text states. For invoicing, preview the actual seller identity/logo in a document before enabling that template.

Limit: the Invoice tab was visible but not selected in these captures; no invoice-specific branding preview was reviewed. Do not claim Stripe's KYC, regional identifiers, bank-account collection or taxonomy is required for a standard Warpdrive license customer.

### MB07 : Stripe: creating an invoice template

Link: <https://mobbin.com/flows/4cdb55ff-a2dd-409c-87ec-5856ff903fed>.

Selected frames **1, 3 and 5 of 5** visually inspected; adjacent blank/submit editor states were visible.

Observed:

- Empty invoice-template directory has clear Create template action and All/Active/Archived counts.
- Focused editor separates internal **template name** (only the team sees it), invoice **memo**, **footer**, **custom fields** and optional line-item grouping.
- Right side is a document preview, with an invoice-ID selector for previewing a matching invoice. Example shows invoice number, issue/due dates, seller/buyer, amounts and logo.
- Final directory contains the created template as an **Active** row with creation date/status and a contextual menu.

Adaptation: company information should feed a later **Your invoicing → Invoice design** editor, with seller-identity summary and preview. Keep internal template names separate from recipient-facing text. Save a reusable template separately from finalizing/sending an invoice; validate legal document fields in the issuing workflow, not merely through the visual preview.

Gaps: no invoice-number generation guarantees, accounting posting, tax calculation or EN16931/XRechnung validation was shown. A PDF preview is not e-invoice readiness.

### MB08 : Stripe: verifying a business

Link: <https://mobbin.com/flows/256fc9e4-24f7-4a48-bebc-7615f033a230>.

Selected frames **1, 8, 9, 10 and 11 of 18** visually inspected.

Observed:

- Start asks business location, a country-specific registration question and conditional business type; step list distinguishes business type/details, account representative, products/services, public details, statement descriptor, bank, security and review.
- Website question explains the intended use and permits an alternative social/mobile URL in its provider-specific context.
- Activity question asks **What products or services will you offer?** with category and description.
- Category menu is **searchable and hierarchical**. Visible choices include Software, Clothing and accessories, Consulting services, Retail, Digital products, Food and drink, Professional services, Membership organizations, Personal services, Transportation and Travel/lodging.
- Completed state selects Software and adds a plain-language service description.

Adaptation: use a searchable business-type picker with common plain-language choices, categories and an escape hatch for a business that does not fit. Store stable industry codes separately from display labels. Add an optional short business description and, separately, workflows/goals. A mechanic, studio and consultancy should not all receive one generic sales-only default; they should see a **proposed configuration** based on confirmed work type.

Do not copy: payment-provider representative identity, personal birth dates, regulated onboarding disclosures or bank details into the standard company profile. The activity taxonomy exists for payments here; Warpdrive can borrow the searchable category pattern without using a payment merchant-category code as its only personalization taxonomy.

## Field-to-pattern mapping

| Warpdrive information                | Strongest directly reviewed reference | Proposed collection location/trigger                                                         |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Display name, logo, workspace handle | MB01/02                               | Company profile or lightweight setup; immediate workspace preview; logo optional             |
| Country                              | MB02/05/08                            | Legal/billing setup; searchable picker; drives conditional address/tax labels                |
| Legal name and address               | MB04/05                               | Legal entities/billing identity; explicit confirmation before invoicing                      |
| Industry/business activity           | MB08                                  | Optional Business profile; searchable categories and short description                       |
| Employee band                        | MB05                                  | Optional Business profile; explanation of personalization value                              |
| Primary work/use case                | MB05                                  | Workspace setup and editable Settings; primary/secondary choices; review defaults            |
| Billing email/finance contacts       | MB01/04                               | Warpdrive billing, with explicit billing recipient role                                      |
| Payment method                       | MB03                                  | Dedicated provider-controlled payment setup; masked summary afterward                        |
| Invoice history/download             | MB01/03                               | Warpdrive billing; provider status/date/reference and authorized download                    |
| Brand icon/logo/colors               | MB06                                  | Branding; preview affected surfaces and preserve accessible UI states                        |
| Seller invoice defaults and template | MB07                                  | Your invoicing; contextual seller identity, document preview and distinct save/issue actions |

## Recommended Warpdrive flow

1. **Company profile:** display name, optional website → offer source-labeled company/logo suggestions → user confirms. Manual entry and skip remain available.
2. **Tailor workspace:** business type + primary work + optional company-size band → preview recommended pipeline/fields/templates → Apply selected suggestions. Keep all choices editable later in Settings and do not erase existing configuration when business type changes.
3. **Buy/manage Warpdrive:** legal billing party and country → structured address/tax fields as applicable → billing contact → provider payment setup or invoice-payment terms → review plan/price/terms at purchase. This is a proposed new commercial scope, not a current capability claim.
4. **Enable your own invoices:** select seller legal entity → required tax/registration/payment/delivery defaults → document branding/numbering/template → completeness/validation review → enable issuing workflow. Bank/payee changes have clear scope and effect; existing issued documents retain their historical identity.

All four remain reachable from Settings. They can share confirmed legal-entity data explicitly without treating workspace display identity, payer and seller as the same thing.

## Remaining research/design gaps

- None of these captured selections shows a complete EU VAT validation success/unavailable/mismatch flow or a company-register match/disambiguation flow.
- No e-invoice endpoint/Peppol/Leitweg-ID setup or XRechnung/EN16931 validation journey was reviewed.
- No CEO collection screen was found in the selected flows. Do not invent one or make CEO mandatory based on these references.
- Full save-failure/retry/conflicting-edit, provider no-match and invoice-payment failure states need Warpdrive-specific design; captures mainly show ordinary progression.
- Mobile and keyboard/screen-reader behavior plus German text expansion/Farsi RTL remain implementation acceptance work. Mixed-direction URLs/IDs, localized country labels and document-language choices need explicit treatment.
- User roles and actual server capabilities must drive visibility. A nice reference screen does not establish isolation, billing authority or a working provider.

Eight useful flows now cover exact company, logo, size, activity, purpose, billing payment and invoice-template information. Evidence-backed recommendations above remain product proposals, without code changes or claims of implemented billing.

# Production starter templates v1, source proposal

31 October 2026. This data-only increment supplies the three AP-05.2 starter manifests using the existing v1 JSON boundary. The source copy is complete in Farsi, German and English. Native-language review, preview/install UI, identity mapping, persistence and runtime acceptance remain open.

| Template ID and version | Production context | Unresolved roles | Deliverables |
| --- | --- | --- | --- |
| `modeling_project`, version 1 | پروژه مدل‌سازی سه‌بعدی / 3D-Modellierung / 3D modeling | Internal producer and modeler contact | 3D model |
| `short_video`, version 1 | تولید ویدیوی کوتاه / Kurzes Video / Short video production | Internal producer and editor contact | Video cut |
| `campaign_content`, version 1 | تولید محتوای کمپین / Kampagneninhalte / Campaign content production | Internal producer, designer contact and editor contact | Campaign design and campaign video cut |

Each starter has briefing, production and internal-review stages. It includes an internal brief/role follow-up, production assignment intent, an internal client-update follow-up and a later-stage review checkpoint for each deliverable. Review checkpoints reference deliverables from the preceding production stage. Campaign design and editing have separate assignments and review checkpoints.

No actual user, contact, recipient, address or availability is embedded. The producer and freelancer roles are unresolved local placeholders. Mapping a role will require a real selected internal user or person/contact through the accepted owner APIs and current permissions. A client-update follow-up is internal intent; it is not recorded communication or sending evidence. Review intent is not approval.

## Editable date assumptions

All offsets explicitly use `calendar-days` from `project-start`. They are illustrative planning assumptions:

| Starter | Brief follow-up | Client-update follow-up | Production assignment | Internal review |
| --- | --- | --- | --- | --- |
| Modeling | Day 0 | Day 2 | Day 4 | Day 5 |
| Short video | Day 0 | Day 2 | Day 3 | Day 4 |
| Campaign | Day 0 | Day 3 | Design day 4, video day 5 | Both day 6 |

Every description asks the user to review scope, role mapping and dates and to agree delivery dates separately. These offsets do not select a calendar, timezone, workweek or holiday rule. No dates or deadlines are calculated. The later preview must expose editable assumptions and use the Calendar owner's agreed semantics before any installation.

## Safe catalog and read boundary

`listStarterTemplates()` returns the three manifests in the declared catalog order through `parseTemplateManifestJson` and `Result`. `readStarterTemplate(templateId)` uses the same actual parser and verifies the manifest ID matches the catalog key. Unknown IDs return `starter_unavailable`.

The module holds private serialized source text and parses it for every retrieval. Caller changes to a returned label, role, stage or dependency array therefore cannot corrupt later individual or catalog reads. These defensive copies protect the source catalog only. They do not prove immutable database publication, atomic installation or persisted version compatibility.

There is no installer, activation control, actual task/activity creation, workflow action, provider call, message, approval, budget or included revision-round promise. Published-version persistence, stable install mappings, local overrides and template evolution belong to later AP-05 tasks and remain unavailable here.

## Scoped red/green evidence

Pinned Bun 1.4.4, Vitest 5.0.5, one worker in the task-owned checkout. A disk check above 2 GiB preceded every test run. No install, broad type/lint/build campaign, database, browser, migration or shared-interface change was performed by this increment.

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/templates/starterTemplates.test.ts --maxWorkers=1
```

- `starter-templates-red-missing.log`: exit 1, implementation module absent before production source.
- `starter-templates-red-incomplete.log`: exit 1, 6 failed and 7 passed with only modeling in the catalog.
- `starter-templates-green.log`: exit 0, 13 passed after adding video/campaign data.
- `starter-templates-green-formatted.log`: exit 0, 13 passed after formatting.

Copies of these exact logs and source hashes are in `evidence/` and `qualification-starter-templates.json`. Tests cover the three valid versioned manifests, localized source copy, unresolved role/deliverable intent, later-stage review, unknown-ID unavailability, excluded identity/commercial/activation fields and caller-mutation isolation. Static checks and these synthetic tests are separate from native-language review, agency feedback, runtime installation and release acceptance.

Post-starter scoped types/lint and combined feature selection have not run. They were initially held below the disk guard and remain held during the 1 November MAIL recovery window. The earlier 285-case selection and this separate 13-case result must not be described as an integrated 298-case pass.

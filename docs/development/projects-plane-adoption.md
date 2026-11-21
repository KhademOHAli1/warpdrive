# Plane Community adoption in Warpdrive Projects

The local comparison uses Plane Community v1.5.0 at
`18caf808a3af3fcabeeba7d1e8473f1367bff2d4`. The workspace directory is
`/comparison/projects/`. Its member profile needs a user ID in
`/comparison/profile/<userId>/`. The document workspace is the project-scoped
Pages route. These are separate from Plane’s account settings and public Spaces.

| Area               | Reused source and Warpdrive behavior                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects directory | Adapted Plane card, search, ordering, and filter patterns use Core’s permission-filtered projects and authoritative creation dates. Creation and project links still use Warpdrive project IDs.                                                                                                                                                       |
| Work items         | Adapted Plane layout selection and navigation. List groups by status, and Board shares the same records. A deep link opens work-item properties. Creation and updates support description, priority, dates, status, and authorized assignment. The 0122 migration preserves old identities and revisions and leaves unknown creators null.            |
| Your work          | Adapted the Plane profile navigation and stat content. Summary, Assigned, Created, Subscribed, and Activity use the signed-in member’s readable internal projects. Status and priority links lead to filtered work, and item links open their project detail. Subscriptions track followed items. Activity records committed item creation and edits. |
| Pages              | Adapted Plane’s Project, Private, and Archived tabs, create-and-open flow, and editor commands. Core stores one project-scoped page with sanitized rich text, lock and archive state, and revision history. A private page and its revisions require current project access and authorship.                                                           |
| Compatibility      | Client projects keep their paths, existing data and access. Projects uses the native Web/Core command boundary and project-local roles. Existing Work Profile and CRM activity records remain separate.                                                                                                                                               |

## Project workflows

| Plane Community source | Warpdrive behavior |
| --- | --- |
| `packages/constants/src/settings/project.ts` and `apps/web/components/settings/project` | Owners manage the project name, identifier, description, lead, default assignee, archive and restore. States have categories, colors, order and a default. Work items keep their project-scoped sequence across edits and their UUID links across identifier changes. |
| `apps/web/components/cycles`, `apps/web/components/modules` and `apps/web/components/views` | Cycles schedule work in non-overlapping periods. Modules group related work. A work item can belong to one cycle and several modules. Their detail pages open scoped work in any of the five layouts. Saved views store the layout and filters and can be private or available to project members. |
| `apps/web/components/issues/issue-layouts` | List, Board, Calendar, Gantt and Spreadsheet use the same Core work items. Calendar supports month and week navigation, date assignment and creation. Gantt supports date changes by drag, resize or keyboard. Spreadsheet supports editing items in place. |
| `apps/web/components/pages` and `packages/editor` | Project Pages merge live Yjs changes and show same-page cursors and participants over the authenticated Web/Core boundary. Core continues to enforce project membership, private authorship, locking and archive controls. Restoring a version invalidates edit deltas from the previous session. |

Migration `0124` seeds and backfills internal project states, identifiers and
work-item sequences. It retains client projects and their links, history and
receipts. The populated PostgreSQL suite covers preexisting work items,
project-role checks, cross-project denial, planning assignment, private views
and live editing. The previous milestone's image rehearsal predates this
migration.

## Intake, work structure, and execution

| Plane Community source | Warpdrive behavior |
| --- | --- |
| `apps/api/plane/app/views/intake/base.py` and `apps/api/plane/db/models/intake.py` | Owners enable Intake. Members submit requests, editors can read the queue, and viewers see their own submissions. Owners accept, decline, snooze, reopen or mark a request as a duplicate. Acceptance atomically creates one work item with the requester as author and records the reviewer. |
| `apps/web/components/labels` and `apps/web/components/estimates` | Projects own their label groups and estimate definitions. Work items use concrete labels and the active enabled estimate scale. Points and Categories are available. Historic estimate choices survive scale changes, and point replacement reconciles dependent work. |
| `apps/api/plane/bgtasks/issue_automation_task.py` and `apps/api/plane/celery.py` | The worker runs at 01:00 UTC. Auto-close moves inactive open work to the selected cancelled state. Auto-archive removes inactive completed or cancelled work from active layouts. Both protect work with current or undated cycle or module commitments. Archive readers use the same project grants, and editors can restore items. |
| `apps/web/components/cycles` and `packages/constants/src/issue/filter.ts` | Rollover moves unfinished work to an eligible cycle in the same project and preserves a pre-transfer progress snapshot. Saved views support personal favorites, creator-controlled locks, ordering, grouping, Board subgroups, visible fields, filters, and link, open, archive, and delete actions. |

Migration `0125` keeps existing work-item and client project identifiers
and backfills the inactivity clock from committed work-item history. Intake,
work structure, and automations add project-scoped records and no provider
connection. Project archiving pauses the rules and leaves the records
available to authorized readers.

Saved view controls apply to the work-item fields available in Warpdrive,
including its existing project membership and assignment model.

## Published boards, guest access, branding and the integrator API

| Plane Community source | Warpdrive behavior |
| --- | --- |
| `apps/web/components/project/publish-project`, `apps/space/app/issues/[anchor]`, and `apps/api/plane/space/views/intake.py` | Project owners publish or revoke an opaque link. Each publication chooses List and Board layouts and can explicitly expose work-item keys, titles, states, or branding. Authenticated visitors can submit, read, edit, snooze-track, and withdraw their own published requests. Review remains in the native Intake queue. |
| `apps/api/plane/app/views/project/member.py`, `apps/api/plane/app/views/workspace/invite.py`, and `guest_view_all_features` in `apps/api/plane/db/models/project.py` | Workspace-visible projects are discoverable by signed-in staff, with explicit join. Owners can grant an existing user the project guest role or invite a verified Projects-only account. Restricted guests see their own items and Intake. Owners can expand guest reads. Projects-only accounts use a scoped shell and cannot use staff or integrator credentials. |
| `apps/web/components/project/form.tsx`, `apps/web/components/project/card.tsx`, and `apps/api/plane/db/models/project.py` | Creation and General settings support emoji or colored icon, preset or uploaded cover, and an IANA time zone. Warpdrive renders branding in the directory, work workspace, and optionally on the public board. Custom cover bytes are normalized and served through current access checks. |
| `apps/api/plane/app/views/cycle/base.py`, `apps/api/plane/api/serializers/cycle.py`, and `apps/api/plane/db/models/project.py` | The saved zone determines cycle boundaries, valid cycle assignments, ongoing-plan protection, and Calendar and Gantt day selection. Snoozes wake at the chosen day's local midnight. Changing the zone retimes pending snoozes to the same civil date. Existing projects start in UTC. |
| `apps/api/plane/api/urls/__init__.py` and `apps/api/plane/api/views` | Personal keys use Plane’s `X-API-Key` convention. The native API understands projects, work items and legacy `issues` paths, workflow states, labels, members, cycles, modules, activity, and internal Intake. Reads and changes recheck the same project grants as Web. |

Use Settings → Projects API keys to issue and revoke credentials. The API
base on a Warpdrive installation is `/api/v1/workspaces/warpdrive`. Keys
can be read-only or read/write. Warpdrive has one installation workspace,
one work-item assignee, and native archiving semantics. Integration clients
see native Intake request IDs and separate linked work-item IDs.

The public board uses Warpdrive's verified invitation flow for external
accounts. Plane Spaces also supports instance-configured direct signup
and public comments, reactions and votes. Those engagement features are
outside this published Intake path. Plane Integrator routes for work-item
links, comments, attachments, and relations, workspace-wide invitation
administration and asset services require backing features outside this
Projects API implementation. Plane’s pinned estimate-management endpoint
code is not mounted in its v1 API. Warpdrive work-item estimate references
use the existing project catalog.

Migration `0126` adds dormant-by-default publication and guest controls,
normalized cover storage, and hashed API key custody. It preserves
the existing internal and client project data through the same journal.

Pages collaboration uses authenticated HTTP exchanges. Peers disappear from
the active list after 15 seconds. Expired rows are removed on later
collaboration traffic or when their session or page is deleted.

Adapted source files retain their notices. The Plane comparison checkout is
available for checking these workflows against the local Warpdrive demo.

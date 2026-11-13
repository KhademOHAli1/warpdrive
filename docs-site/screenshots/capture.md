# Capturing docs screenshots

All screenshots under `docs-site/static/img/screenshots/<feature>/` are captured from a
**locally seeded demo instance**, never from production.

## Why local, not production

Screenshots are public. Use a fresh local database, private storage bucket, and
browser profile created for the capture. A shared development database may still
contain real records after seeding, and an existing browser profile may fill in
saved account details.

## Setup

1. In a dedicated checkout, install the locked dependencies using the
   [contributor setup](../docs/contributing.md#running-locally). Provision a
   disposable local PostgreSQL database and a private test bucket for the
   capture. Use separate credentials and free loopback ports. If using Compose,
   use a dedicated project and check the configured ports before starting it.
2. Create a fresh local `.env` from `.env.example` in that checkout. Set
   `MIGRATION_DATABASE_URL` and `DATABASE_URL` to the same disposable database,
   with the migration owner and the separate runtime login respectively. Clear
   inherited configuration that points to other services. Leave real provider
   integrations unconfigured and set `AUTH_MAIL_TRANSPORT=capture`,
   `DISABLE_TELEMETRY=true`, and `DISABLE_UPDATE_CHECK=true`.
3. Confirm both connection strings point at the capture database. Run
   `bun run db:migrate` and apply the
   [runtime grants](../docs/setup.md#3-bring-it-up) to the capture login.
   Then run `bun run db:seed:demo` from the repository root. The seed uses
   `DATABASE_URL` and can rewrite demo records, so verify the database before
   running it.
4. Before taking screenshots, inspect the users table in that database:

   ```sql
   SELECT email FROM users ORDER BY email;
   ```

   Confirm the list contains only the synthetic accounts defined by
   `scripts/seed-demo.ts`, `scripts/seed-demo-users.ts`, and
   `scripts/seed-demo-graph.ts`. Check the visible records in every shot for real
   names, addresses, account details, and browser autofill before saving it.
5. Use a free port for the app. For example, set `BASE_URL=http://localhost:3010`
   and run:

   ```sh
   bun run dev --hostname 127.0.0.1 --port 3010
   ```

   The fixture route `/auth/dev-login?email=demo1@example.com` needs
   `ALLOW_FIRST_LOGIN_ADMIN=true` in a non-production process. Enable it only in
   this loopback-bound capture environment. Open the route in the new browser
   profile and verify that the synthetic administrator can open the settings
   pages you plan to capture.
6. After capture, close the dedicated browser profile, stop the processes you
   started, and remove the disposable database, bucket, and capture credentials.

## Capture parameters

| Setting | Value |
| --- | --- |
| Viewport | 1440x900 |
| Theme | Light |
| Device pixel ratio | 2 |
| Browser chrome | Excluded, capture the page only |

Save each shot to `docs-site/static/img/screenshots/<feature>/<filename>` exactly as
named in the table below. The Docusaurus build **fails on a missing image**, so a
typo in a filename is caught at build time rather than shipping as a broken image.

### Two things that silently ruin shots

**Wait for the page content.** Check that loading placeholders have disappeared
and the expected records are visible before taking a shot.

**Suppress the dev overlay and animations.** The Next.js dev indicator sits in the
bottom-left corner of every page, and sidebar transitions get captured mid-flight.
Inject this before each screenshot:

```js
const s = document.createElement("style");
s.textContent =
  "nextjs-portal,[data-nextjs-toast]{display:none!important}" +
  "*{transition:none!important;animation:none!important}";
document.head.appendChild(s);
```

## Reproducibility

The demo seed is **not** currently byte-reproducible. Its content PRNG is deterministic
(Mulberry32, fixed seed), but timestamps, database-generated UUIDs, and some query
ordering vary between runs, so re-seeding produces cosmetically different data. The UI
also renders relative dates and overdue and rotting styling against the real clock.

Replace a committed PNG when its labels, layout, or interaction no longer match
the guide. Record the captured revision with the screenshot change.

## Capturing interaction states

Seven shots show a transient state rather than a page. Three techniques cover them.

**Open a control, then screenshot.** Use accessible names rather than CSS selectors:

```sh
agent-browser find role button click --name "Filter"
agent-browser find role button click --name "Notifications"
```

**Type into a dialog with `fill`, not `keyboard type`.** Keystrokes sent without a
target can miss the focused input entirely, and the search modal then shows
"No deals / No people / No organizations", which reads exactly like a broken search
rather than a missed keystroke. Snapshot for the ref and fill it:

```sh
agent-browser find role button click --name "Open search"
agent-browser snapshot -i           # -> searchbox "Search" [ref=e4]
agent-browser fill @e4 "Apex"
```

**For a mid-drag frame, hold a real mouse drag.** `agent-browser drag` completes the
drop, so it cannot show the lifted card. Synthetic `PointerEvent`s do not activate
dnd-kit either. Use the low-level mouse commands, and step past the 8px activation
threshold in small increments, because a single large jump does not register:

```sh
agent-browser mouse move 392 275
agent-browser mouse down
for y in 278 282 288 296 310 330 360 400 440; do
  agent-browser mouse move 400 $y
done
agent-browser screenshot .../pipeline/board-drag.png
agent-browser mouse up      # always release, or the next shot is captured mid-drag
```

Row checkboxes need the same care: clicking the DOM node with `.click()` does not
update React state. Click the snapshot ref instead.

## Shot table

Each row is `page -> route -> setup -> filename`.

### Pipeline

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Board | `/pipeline/[id]` | Populated stages with values, labels, owners | `pipeline/board.png` |
| Moving deals | `/pipeline/[id]` | Begin dragging a card, hold | `pipeline/board-drag.png` |
| Filtering | `/pipeline/[id]` | Open Filter, apply 2+ conditions | `pipeline/board-filter.png` |
| List | `/pipeline/[id]/list` | Default columns | `pipeline/list.png` |
| Bulk actions | `/pipeline/[id]/list` | Select 3 rows, open stage picker | `pipeline/list-bulk.png` |
| Archive | `/pipeline/[id]/archived` | Archive an open and a lost deal first | `pipeline/archived.png` |
| Creating deals | `/pipeline/[id]` | Click `+ Deal` | `pipeline/add-deal.png` |
| Configuring stages | `/pipeline/[id]/edit` | Several stages, rotting on one | `pipeline/edit.png` |

### Deal workspace

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Overview | `/deals/[dealId]` | Deal with activities, notes, participants | `deal-workspace/detail.png` |
| Inline editing | `/deals/[dealId]` | Click a summary field to edit | `deal-workspace/inline-edit.png` |

### Leads, contacts, activities

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Leads inbox | `/leads` | Several active leads | `leads/list.png` |
| People list | `/contacts/people` | Populated | `contacts/people-list.png` |
| Organization detail | `/contacts/orgs/[orgId]` | Org with people and deals | `contacts/org-detail.png` |
| Activities list | `/activities/list` | Mixed overdue, upcoming, done | `activities/list.png` |
| Activities calendar | `/activities/calendar` | Same week populated | `activities/calendar.png` |

### Email

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Inbox | `/inbox` | Seeded threads | `email/inbox.png` |
| Composer | `/inbox/compose` | Recipient and subject filled | `email/compose.png` |

### Other features

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Import wizard | `/settings/import/new` | Mapping step, columns mapped | `import/wizard.png` |
| Dashboard | `/dashboard` | Seeded deals across stages | `dashboard/overview.png` |
| Notifications | any | Open the bell with unread items | `notifications/panel.png` |
| Search | any | Type a term matching several types | `search/results.png` |
| Saved filters | `/pipeline/[id]` | Open the dialog for saving a filter | `saved-filters/create.png` |

### Administration

| Page section | Route | Setup | Filename |
| --- | --- | --- | --- |
| Users | `/settings/users` | Active, invited, deactivated all present | `users/list.png` |
| Teams | `/settings/teams` | Teams with and without managers | `teams/list.png` |
| Permission sets | `/settings/permission-sets` | Regular and Admin plus one custom | `permission-sets/list.png` |
| Visibility groups | `/settings/visibility-groups` | Everyone plus one custom group | `visibility-groups/list.png` |
| Labels | `/settings/company/labels` | Default label set | `company-settings/labels.png` |
| Data fields | `/settings/fields` | At least one custom field added | `data-fields/list.png` |
| Email sync | `/settings/email-sync` | Disconnected state is fine | `email-sync/settings.png` |

## Adding a new shot

1. Add a row to the table above.
2. Capture it with the parameters above.
3. Reference it from the page as `/img/screenshots/<feature>/<filename>`.
4. Run `bun --cwd docs-site run build` to confirm it resolves.

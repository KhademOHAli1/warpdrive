# Updating shadcn/ui

The CRM uses the current Radix Nova registry with RTL enabled. `components.json` points the
shadcn CLI at `src/components/ui/primitives/`. These files are generated from the official
registry and should stay unmodified. Their MIT notice is in `third-party/shadcn-LICENSE.md`.

The existing files directly inside `src/components/ui/` are CRM adapters. Feature code keeps
importing these files. They preserve the application's compact sizing, action colors, accessible
labels, empty-string select values, dialog telemetry, calendar behavior and chart formatters.
Changes to CRM behavior belong in these adapters, so a registry refresh can replace the primitive
files without overwriting them. Calendar, color and time pickers are compositions of the shared
primitives rather than standalone upstream registry components.

## Review and apply a release

```sh
# Update the locally pinned CLI when adopting a new CLI release.
bun update shadcn --latest

# Check that registry files have no unreviewed local changes, then preview remote changes.
bun run ui:check

# Refresh all installed registry components, run types and focused tests, and record their hashes.
bun run ui:update
```

`shadcn.registry.json` lists every managed component. `shadcn.lock.json` records the CLI version,
review time and generated source hashes. `bun run ui:audit` checks those hashes locally, without
network access. The registry is published separately from the CLI; the lock records the exact
generated files because a CLI version alone does not pin registry contents.

Review the diff in `package.json`, `bun.lock`, `components.json` and the primitive files. The
registry can change dependency requirements, so check those changes against the other consumers
of those packages. For example, the current chart registry requests Recharts 3.8.0, while the CRM
is verified with the newer compatible 3.10.1. Keep a compatible dependency set and rerun
`bun run ui:verify` after changing it. An update that fails verification leaves its source changes
available for repair and does not advance the reviewed snapshot. After repairing it, run
`bun run ui:record`, which verifies again before recording the snapshot.

Do not run `shadcn add --overwrite --path src/components/ui`; that would target CRM adapters.
Use the configured alias or the managed commands above. New registry components should also be
added to `shadcn.registry.json`.

## Direction and behavior

The language provider wraps the app in shadcn's Radix direction context. The root document has
the same `dir` value. Popovers, dialogs, sheets, selects and tooltips also receive the appropriate
direction at their portal boundary. Menus, radios and tabs use the shared Radix direction context
for keyboard navigation. Detail sheets open from the right in LTR and from the left in RTL.

`iconDirection.css` mirrors horizontal navigation and directional actions such as back,
next, reply and undo using inherited `:dir(rtl)`. Checkmarks, search, calendars, charts,
sidebar pictograms, editor alignment symbols and vertical arrows keep their original shape.
A new directional symbol can opt in with `data-rtl-mirror="true"`; do not mirror an entire
icon family. The policy respects nested LTR content and skips existing shadcn RTL transforms.
Components that already choose a physical icon from direction, such as the sidebar toggle,
use `data-rtl-mirror="false"` to avoid a second flip.

Collapsible section chevrons use `data-disclosure-chevron` with their open/closed state:
closed points toward the label (right in LTR, left in RTL), expanded points down. Static
section headings have no disclosure icon. Keep these policies outside generated primitives
so registry updates preserve them.

Three adapters intentionally use a lower-level Radix leaf where the registry component does not
expose the required API: `Progress` preserves custom maximum/clamping and mirrors its fill in
RTL; `RadioGroupItem` allows custom stage-chevron children; `TooltipContent` omits the registry's
mandatory arrow for compact hints. All three use the current unified
`radix-ui` dependency. Their default counterparts remain in the managed registry for comparison.
The direction adapter also normalizes the upstream provider's required `dir` prop.

Before accepting an update, run `bun run ui:verify` and the affected feature tests. In the browser,
check both languages: opening/closing overlays, focus restoration, tab/radio arrow navigation,
selecting an empty option, mixed checkboxes, the Iranian calendar and sheets. Review light and
dark appearance, narrow screens and reduced-motion behavior. The application-specific pipeline
board and other feature layouts still need their own RTL review; updating primitives does not
translate those screens or redesign their layouts.

Formatting/linting excludes the replaceable primitive directory to keep registry snapshots
pristine. TypeScript and runtime tests still cover it; CRM adapters retain normal linting.

Official references: [RTL migration](https://ui.shadcn.com/docs/rtl),
[CLI update previews](https://ui.shadcn.com/docs/cli),
[Radix direction provider](https://ui.shadcn.com/docs/components/radix/direction).

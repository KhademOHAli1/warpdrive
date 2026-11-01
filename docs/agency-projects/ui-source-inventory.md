# Agency Projects current-shell source inventory

31 October 2026. Source-only review for AP-01.1. This records available implementation seams, not browser acceptance or a proposed redesign.

1 November amendment: Settings `ec9b3f8943e42736edc6713c099fd2ef14068d0a` is committed in Agency merge `980833d`, and Sales `f006b5a5026449fd2bf792439b9149ba3517feb8` is committed in Agency merge `264d9b2`. Read `settings-adoption.md` and `sales-adoption.md` for exact seams, owner reports and remaining combined gates. Sales adds saved-view/query recovery and guarded pipeline UI without replacing the adopted Settings sources. The initial observations below remain tied to their original source, and their dirty-Settings status is historical. No combined native UI acceptance follows from these source merges.

## Exact source and adoption boundary

- Agency checkout: `/Users/ali/Developer/warpdrive-agency-projects`, base `67eb151f228d9a2866d51266420e9fb915a77739`.
- Paths below were inspected in that isolated checkout. At inspection, its only working changes were agency documentation.
- Settings checkout: `/Users/ali/Developer/warpdrive-settings-ux`, committed HEAD `a1a8f6da1ce366c35002900bf33508356dfbb995`.
- Settings handoff: `/Users/ali/Documents/Codex/2026-10-31/warpdrive-settings-ux/outputs/implementation-coordination.md`. Its implementation remains dirty and code-frozen for combined qualification. No dirty Settings file was imported.
- This review makes no claim that the base includes the latest Settings presentation. Adopt a later owner-supplied committed cut before combined UI acceptance.

## Preserved design and implementation seams

| Area | Source at agency base | Observed behavior to preserve |
| --- | --- | --- |
| Fonts and document direction | `src/app/layout.tsx`, `src/app/globals.css` | Vendored Inter and Vazirmatn; document `lang` and `dir` follow locale; `html:lang(fa)` selects Vazirmatn. No remote font dependency. |
| Type and tokens | `src/app/globals.css` | Display size 1.5625rem, ordinary compact text, semantic light/dark colors, action green, base radius 0.5rem. Radius utilities derive from that scale. |
| Authenticated shell | `src/app/(app)/layout.tsx` | Existing native context, pending-auth continuation, CSRF refresher, TopBar, sidebar, reconnect/error surfaces, interface density and appearance. Main content uses `min-w-0`, scroll containment and existing page padding. |
| Primary navigation | `src/components/shell/LeftNav.tsx`, `LeftNav.module.css`, `SidebarMenu.tsx`, `src/constants/nav.ts` | Expanded/collapsed desktop rail, logical edges, mobile Sheet below 1024px, current-page state, localized labels and reduced-motion overrides. Mobile close restores trigger focus. |
| Headings | `src/components/shell/PageHeading.tsx` | Breadcrumb navigation, `bdi` for names, shared display heading at weight 450, description and actions. Use existing scope rather than a new heading system. |
| Settings composition | `src/app/(app)/settings/SettingsSurface.tsx`, `SettingsHeading.tsx`, `layout.tsx` | Page/card/header/body/footer surfaces, compact table spacing, scope labels, permission-aware secondary navigation. These are existing app-local surfaces, not a new public component API. |
| Secondary links | `src/components/navigation/SecondaryNavLink.tsx` | Shared compact row, active colors and `aria-current`. Current base has no `onNavigate` prop. |
| Inputs and overlays | `src/components/ui/{Button,Input,Textarea,Select,DatePicker}.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `src/components/ConfirmDialog.tsx` | Use CRM adapters above managed shadcn primitives. Preserve action variants, compact sizing, localization, direction, focus behavior and pending disablement. |
| Locale and regional preferences | `src/features/i18n/LocaleProvider.tsx`, `src/features/identity/interfacePrefs.ts` | Existing translators and Radix direction context; locale/calendar/timezone/numbering are distinct preferences. Currency and money-unit selection remain separate. |

`docs/ui-updates.md` owns primitive/adaptor maintenance. Do not overwrite `src/components/ui/primitives/`, refresh registries during agency feature work, or replace existing dialogs/selects with custom overlays/native controls.

## Dirty Settings proposals requiring committed owner handoff

Read-only diff confirmed these pending shared changes at the Settings HEAD above:

| Path | Pending change | Agency implication |
| --- | --- | --- |
| `src/components/shell/PageHeading.tsx` | Long breadcrumb/title wrapping; vertically stacked actions on narrow screens | Preserve when adopting the owner's committed cut; do not copy the older heading over it. |
| `src/components/navigation/SecondaryNavLink.tsx` | Optional `onNavigate` callback | Potential mobile dismissal seam, unavailable as a base export today. |
| `src/components/ConfirmDialog.tsx` | Optional `secondaryAction` | Potential honest recovery choice; not an existing base prop and not permission to invent unavailable backend actions. |

The handoff also protects pending Settings forms, imports and message catalogs. Unknown create results keep drafts and require recovery based on actual identity/receipts. An already validated import batch cannot be remapped through an invented Back action. A permission set named Admin never changes native actor authority.

## Agency extension and acceptance work still open

Implement feature-local agency components/catalogs first. Primary navigation, catalog registration and shared adapter changes require narrow owner-reviewed patches. No navigation link alone enables server access or effects.

Before AP-01.1/AP-01.8 acceptance, capture the accepted combined shell and agency workflows at desktop and 390px, light/dark, FA/DE/EN, long German and mixed-script content, keyboard-only use, dialog return focus, 200% zoom and reduced motion. Source inspection supplies none of that native evidence. Record the exact runtime/source and independently chosen calendar/timezone/digits/money unit for each journey.

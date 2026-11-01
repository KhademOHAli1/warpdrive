"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { listCompatibleSavedFilterViews } from "@/features/saved-filters/savedFilterList";
import {
  SAVED_VIEW_SELECTION_KEYS,
  savedViewSelectionActorHintSchema,
  savedViewSelectionInputSchema,
} from "@/features/saved-filters/savedViewSelectionSchema";
import type { SavedViewPresentationTarget } from "@/features/saved-filters/viewPresentation";
import type { Appearance } from "@/features/theme/appearance";
import { createContext } from "@/server/trpc/context";
import { setPreferences, setSidebarSectionsPreference } from "./preferencesRepo";
import {
  appearanceSchema,
  boardViewSchema,
  COLUMN_VIEW_KEYS,
  type ColumnViewName,
  columnViewInputSchema,
  type Density,
  dailyActivityTargetSchema,
  dealHeaderBlocksSchema,
  dealSidebarSectionsSchema,
  densitySchema,
  leadsViewSchema,
  openDetailsAfterCreateSchema,
  type ProfilePrefs,
  profilePrefsSchema,
  scheduleFollowUpAfterWonSchema,
  type UiFlagKey,
  uiFlagInputSchema,
} from "./preferencesSchema";

export type PrefActionResult = { ok: true } | { ok: false; error: { id: string } };

async function maySelectSavedView(
  ctx: Parameters<typeof listCompatibleSavedFilterViews>[0],
  targetEntity: SavedViewPresentationTarget,
  savedViewId: string | null,
): Promise<PrefActionResult> {
  if (savedViewId === null) return { ok: true };
  try {
    const visible = await listCompatibleSavedFilterViews(ctx, targetEntity);
    if (!visible.some((view) => view.id === savedViewId))
      return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
    return { ok: true };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    return { ok: false, error: { id: ERROR_IDS.DB_READ_FAILED } };
  }
}

export async function setSavedViewSelectionAction(
  input: unknown,
  csrfToken: string | null = null,
  expectedActorId?: string,
): Promise<PrefActionResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  let ctx: Awaited<ReturnType<typeof createContext>>;
  try {
    ctx = await createContext();
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    return { ok: false, error: { id: ERROR_IDS.DB_READ_FAILED } };
  }
  if (ctx.actor === null || ctx.session === null)
    return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  const expectedActor = savedViewSelectionActorHintSchema.safeParse(expectedActorId);
  if (!expectedActor.success)
    return { ok: false, error: { id: ERROR_IDS.PREF_SAVED_VIEW_SELECTION_INVALID } };
  // The hint can only refuse a deferred write. Authority remains the current native session.
  if (expectedActor.data !== undefined && expectedActor.data !== ctx.actor.id)
    return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  const parsed = savedViewSelectionInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { id: ERROR_IDS.PREF_SAVED_VIEW_SELECTION_INVALID } };
  const { targetEntity, savedViewId } = parsed.data;
  const allowed = await maySelectSavedView({ ...ctx, actor: ctx.actor }, targetEntity, savedViewId);
  if (!allowed.ok) return allowed;
  try {
    await setPreferences(
      ctx.db,
      ctx.actor.id,
      {
        ui: { [SAVED_VIEW_SELECTION_KEYS[targetEntity]]: { version: 1, savedViewId } },
      },
      SIG(),
    );
    return { ok: true };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    return { ok: false, error: { id: ERROR_IDS.DB_WRITE_FAILED } };
  }
}

async function actorId(
  csrfToken: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  return { ok: true, id: actor.id };
}

export async function updateProfilePreferencesAction(
  input: ProfilePrefs,
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const parsed = profilePrefsSchema.parse(input);
  await setPreferences(db, a.id, parsed, SIG());
  return { ok: true };
}

// Display density has its own page. Write only this column so a stale page cannot reset
// a newer language or timezone choice made elsewhere.
export async function setDensityAction(
  input: { density: Density },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const density = densitySchema.parse(input.density);
  await setPreferences(db, a.id, { density }, SIG());
  return { ok: true };
}

export async function setDealHeaderBlocksAction(
  input: { blocks: string[] },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const blocks = dealHeaderBlocksSchema.parse(input.blocks);
  await setPreferences(db, a.id, { ui: { dealHeaderBlocks: blocks } }, SIG());
  return { ok: true };
}

export async function setSidebarSectionsAction(
  input: { sections: unknown[] },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const sections = dealSidebarSectionsSchema.parse(input.sections);
  await setSidebarSectionsPreference(db, a.id, sections, SIG());
  return { ok: true };
}

export async function setLeadsViewAction(
  input: { columns: string[]; sort: { field: string; dir: "asc" | "desc" } },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const leadsView = leadsViewSchema.parse(input);
  await setPreferences(db, a.id, { ui: { leadsView } }, SIG());
  return { ok: true };
}

// The deals board toolbar view (owner filter, sort, applied filter). Written whole each time
// because the jsonb shallow merge replaces the nested object rather than merging into it.
export async function setBoardViewAction(
  input: unknown,
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const boardView = boardViewSchema.parse(input);
  await setPreferences(db, a.id, { ui: { boardView } }, SIG());
  return { ok: true };
}

// Generic list-table column-order persist. `view` selects which top-level ui key is written
// (dealsListView / peopleView / orgsView), each a distinct key so concurrent writes to different
// lists never lost-update one another via the jsonb shallow merge.
export async function setColumnViewAction(
  input: { view: ColumnViewName; columns: string[] },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const parsed = columnViewInputSchema.parse(input);
  const uiKey = COLUMN_VIEW_KEYS[parsed.view];
  await setPreferences(db, a.id, { ui: { [uiKey]: parsed.columns } }, SIG());
  return { ok: true };
}

// Day / Night / System. Its own top-level ui key, so the jsonb shallow merge cannot lost-update a
// sibling preference. The client mirrors the same value into the wd_appearance cookie.
export async function setAppearanceAction(
  input: { appearance: Appearance },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const appearance = appearanceSchema.parse(input.appearance);
  await setPreferences(db, a.id, { ui: { appearance } }, SIG());
  return { ok: true };
}

export async function setScheduleFollowUpAfterWonAction(
  input: { enabled: boolean },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const enabled = scheduleFollowUpAfterWonSchema.parse(input.enabled);
  await setPreferences(db, a.id, { ui: { scheduleFollowUpAfterWon: enabled } }, SIG());
  return { ok: true };
}

// Personal daily activity target. Informational: it colors the day dots in activity date
// pickers and never blocks a create.
export async function setDailyActivityTargetAction(
  input: { target: number },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const target = dailyActivityTargetSchema.parse(input.target);
  await setPreferences(db, a.id, { ui: { dailyActivityTarget: target } }, SIG());
  return { ok: true };
}

// Generic boolean Interface-flag persist. `key` is validated against the whitelist enum so a
// client cannot write an arbitrary ui key; each flag is its own top-level ui key, so the jsonb
// shallow merge never lost-updates a sibling flag.
export async function setUiFlagAction(
  input: { key: UiFlagKey; value: boolean },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const { key, value } = uiFlagInputSchema.parse(input);
  await setPreferences(db, a.id, { ui: { [key]: value } }, SIG());
  return { ok: true };
}

// "Open details view after creating a new item", written whole each time because the jsonb
// shallow merge replaces the nested object rather than merging into it.
export async function setOpenDetailsAfterCreateAction(
  input: { leadDeal: boolean; person: boolean; org: boolean },
  csrfToken: string | null = null,
): Promise<PrefActionResult> {
  const a = await actorId(csrfToken);
  if (!a.ok) return a;
  const openDetailsAfterCreate = openDetailsAfterCreateSchema.parse(input);
  await setPreferences(db, a.id, { ui: { openDetailsAfterCreate } }, SIG());
  return { ok: true };
}

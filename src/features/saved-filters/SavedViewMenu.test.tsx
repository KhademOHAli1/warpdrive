// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SavedViewMenu } from "./SavedViewMenu";
import type { SavedView, SavedViewDefinition } from "./savedView";

const savePreferences = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: savePreferences }));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const DEFINITION: SavedViewDefinition = {
  combinator: "and",
  conditions: [{ field: "primaryEmail", op: "contains", value: "example" }],
};
const cases = [
  {
    locale: "en",
    menu: "Saved views",
    favorite: "Favorite view",
    unfavorite: "Unfavorite view",
    prefix: "International enterprise account management and customer renewal review queue",
  },
  {
    locale: "de",
    menu: "Gespeicherte Ansichten",
    favorite: "Ansicht als Favorit markieren",
    unfavorite: "Ansicht aus Favoriten entfernen",
    prefix: "Internationale Unternehmenskundenbetreuung und Prüfung von Vertragsverlängerungen",
  },
  {
    locale: "fa",
    menu: "نماهای ذخیره‌شده",
    favorite: "افزودن نما به علاقه‌مندی‌ها",
    unfavorite: "حذف نما از علاقه‌مندی‌ها",
    prefix: "صف بررسی حساب‌های سازمانی بین‌المللی و پیگیری تمدید قرارداد مشتریان",
  },
] as const;

it.each(cases)(
  "identifies each owned favorite action by its full view name in $locale",
  async (copy) => {
    const ownedPrivate: SavedView = {
      id: "owned-private",
      name: `${copy.prefix} — 1`,
      favorite: false,
      isShared: false,
      isOwn: true,
      definition: DEFINITION,
    };
    const ownedShared: SavedView = {
      id: "owned-shared",
      name: `${copy.prefix} — 2`,
      favorite: true,
      isShared: true,
      isOwn: true,
      definition: DEFINITION,
    };
    const foreignShared: SavedView = {
      id: "foreign-shared",
      name: `${copy.prefix} — 3`,
      favorite: false,
      isShared: true,
      isOwn: false,
      definition: DEFINITION,
    };
    const favorite = vi.fn();
    const select = vi.fn();
    const remove = vi.fn();
    const save = vi.fn();
    const user = userEvent.setup();
    render(
      <LocaleProvider locale={copy.locale}>
        <SavedViewMenu
          views={[ownedPrivate, ownedShared, foreignShared]}
          selectedViewId={foreignShared.id}
          allRecordsActive={false}
          allLabel="All fixture people"
          canSave
          onSelect={select}
          onToggleFavorite={favorite}
          onDelete={remove}
          onSaveCurrent={save}
        />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: copy.menu }));
    const favoriteItem = screen.getByRole("menuitem", {
      name: `${copy.favorite}: ${ownedPrivate.name}`,
    });
    const unfavoriteItem = screen.getByRole("menuitem", {
      name: `${copy.unfavorite}: ${ownedShared.name}`,
    });
    expect(favoriteItem).toHaveTextContent("☆");
    expect(favoriteItem).not.toHaveTextContent(ownedPrivate.name);
    expect(unfavoriteItem).toHaveTextContent("★");
    expect(unfavoriteItem).not.toHaveTextContent(ownedShared.name);
    for (const owned of [ownedPrivate, ownedShared]) {
      // Both private and shared owned rows retain selection, favorite and delete entries.
      expect(
        screen.getAllByRole("menuitem", { name: (name) => name.includes(owned.name) }),
      ).toHaveLength(3);
    }
    // A foreign shared row stays selectable, with neither owner-scoped mutation offered.
    expect(
      screen.getAllByRole("menuitem", { name: (name) => name.includes(foreignShared.name) }),
    ).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: foreignShared.name })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await user.click(favoriteItem);
    expect(favorite).toHaveBeenNthCalledWith(1, ownedPrivate.id);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(unfavoriteItem);
    expect(favorite).toHaveBeenNthCalledWith(2, ownedShared.id);
    expect(favorite).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: foreignShared.name })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(select).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(savePreferences).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe(copy.locale === "fa" ? "rtl" : "ltr");
  },
);

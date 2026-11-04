// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import german from "./messages/lifecycle.de.json";
import english from "./messages/lifecycle.en.json";
import persian from "./messages/lifecycle.fa.json";
import { PipelineDirectoryRowItem } from "./PipelineDirectoryRow";

const savePreferences = vi.hoisted(() => vi.fn());
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: savePreferences }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const catalogs = { en: english, de: german, fa: persian };
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];

it.each(["en", "de", "fa"] as const)(
  "retains the exact settings pipeline row as the editor return target in %s",
  (locale) => {
    const onSelect = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <ul>
          {ids.map((id, index) => (
            <PipelineDirectoryRowItem
              key={id}
              row={{
                id,
                name: `Enterprise علی — ${index + 1}`,
                isArchived: false,
                updatedAt: "2026-10-31T12:00:00.000Z",
                stageCount: 3,
                dealCount: 4,
                visibility: "workspace",
              }}
              canManage
              onSelect={onSelect}
            />
          ))}
        </ul>
      </LocaleProvider>,
    );
    const editLinks = screen.getAllByRole("link", { name: catalogs[locale].editStages });
    expect(editLinks).toHaveLength(2);
    for (const [index, id] of ids.entries()) {
      const link = editLinks[index];
      expect(link).toHaveAttribute("href", `/pipeline/${id}/edit?from=settings`);
      expect(link?.closest("li")).toHaveAttribute("id", `pipeline-${id}`);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(savePreferences).not.toHaveBeenCalled();
    expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
  },
);

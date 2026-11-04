// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import type { FieldRow } from "./types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

const S = STRINGS.settings;

const actions = vi.hoisted(() => ({
  archiveDefAction: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(() =>
    Promise.resolve({ ok: true, value: { id: "d1" } }),
  ),
  renameDefAction: vi.fn<() => Promise<MockActionResult<{ id: string }>>>(() =>
    Promise.resolve({ ok: true, value: { id: "d1" } }),
  ),
  setDefFlagsAction: vi.fn<() => Promise<MockVoidActionResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/custom-fields/actions", () => actions);

import type { MockActionResult, MockVoidActionResult } from "@/test/actionResult";
import { FieldRowItem } from "./FieldRowItem";

const ROW: FieldRow = {
  id: "d1",
  name: "Budget",
  type: "monetary",
  options: [],
  isImportant: false,
  showInAddForm: false,
};

// FieldRowItem calls useSortable, which reads dnd-kit's React context, so it must render
// under the same DndContext/SortableContext nesting FieldList provides in production.
function renderRow(row: FieldRow): ReturnType<typeof render> {
  return render(
    <DndContext>
      <SortableContext items={[row.id]}>
        <ul>
          <FieldRowItem row={row} isFirst isLast onMove={vi.fn()} />
        </ul>
      </SortableContext>
    </DndContext>,
  );
}

describe("FieldRowItem placement toggles", () => {
  it("identifies the field in each placement switch name", () => {
    renderRow(ROW);
    expect(screen.getByRole("switch", { name: "Important: Budget" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show in add form: Budget" })).toBeInTheDocument();
  });
  it("uses the shared arrow reorder controls", () => {
    const onMove = vi.fn();
    render(
      <ul>
        <FieldRowItem row={ROW} isFirst={false} isLast onMove={onMove} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: `${S.moveUp}: Budget` }));
    expect(onMove).toHaveBeenCalledWith("up");
    expect(screen.getByRole("button", { name: `${S.moveDown}: Budget` })).toBeDisabled();
  });

  it("toggles Important via setDefFlagsAction, sending the full flag pair", async () => {
    renderRow(ROW);
    fireEvent.click(screen.getByRole("switch", { name: "Important: Budget" }));
    await waitFor(() =>
      expect(actions.setDefFlagsAction).toHaveBeenCalledWith(
        { id: "d1", isImportant: true, showInAddForm: false },
        "csrf",
      ),
    );
  });

  it("toggles Show in add form via setDefFlagsAction, sending the full flag pair", async () => {
    renderRow({ ...ROW, isImportant: true });
    fireEvent.click(screen.getByRole("switch", { name: "Show in add form: Budget" }));
    await waitFor(() =>
      expect(actions.setDefFlagsAction).toHaveBeenCalledWith(
        { id: "d1", isImportant: true, showInAddForm: true },
        "csrf",
      ),
    );
  });

  it("reflects the def's current flag state in the switches", () => {
    renderRow({ ...ROW, isImportant: true, showInAddForm: true });
    expect(screen.getByRole("switch", { name: "Important: Budget" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Show in add form: Budget" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("FieldRowItem surfaces failed mutations", () => {
  it("prevents duplicate rename requests and keeps the draft after a network rejection", async () => {
    let rejectSave: (reason: unknown) => void = () => {};
    actions.renameDefAction.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: `${S.rename}: Budget` }));
    fireEvent.change(screen.getByLabelText(`${S.rename}: Budget`), {
      target: { value: "New budget" },
    });
    const save = screen.getByRole("button", { name: `${S.save}: Budget` });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(actions.renameDefAction).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    rejectSave(new Error("offline"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText(`${S.rename}: Budget`)).toHaveValue("New budget");
    expect(screen.getByRole("button", { name: `${S.save}: Budget` })).toBeEnabled();
  });
  it("reports the error id when archive is denied", async () => {
    actions.archiveDefAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: `${S.archive}: Budget` }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when a rename is denied", async () => {
    actions.renameDefAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button", { name: `${S.rename}: Budget` }));
    fireEvent.change(screen.getByLabelText(`${S.rename}: Budget`), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${S.save}: Budget` }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });

  it("reports the error id when a flag toggle is denied", async () => {
    actions.setDefFlagsAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
    renderRow(ROW);
    fireEvent.click(screen.getByRole("switch", { name: `${S.important}: Budget` }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_PERM_001"));
  });
});

const fieldNames = {
  en: [
    "Customer renewal budget for the international enterprise services contract — Northern region",
    "Customer renewal budget for the international enterprise services contract — Southern region",
  ],
  de: [
    "Verlängerungsbudget für den internationalen Unternehmenskundenvertrag und Zusatzleistungen — Nord",
    "Verlängerungsbudget für den internationalen Unternehmenskundenvertrag und Zusatzleistungen — Süd",
  ],
  fa: [
    "بودجهٔ تمدید قرارداد خدمات سازمانی مشتریان بین‌المللی و خدمات تکمیلی — منطقهٔ شمال",
    "بودجهٔ تمدید قرارداد خدمات سازمانی مشتریان بین‌المللی و خدمات تکمیلی — منطقهٔ جنوب",
  ],
} as const;

function renderRowPair(locale: Locale) {
  const names = fieldNames[locale];
  const rows: FieldRow[] = [
    {
      ...ROW,
      id: "field-north",
      name: names[0],
      type: "single_option",
      options: [{ id: "north-option", label: "Northern option" }],
    },
    {
      ...ROW,
      id: "field-south",
      name: names[1],
      type: "multi_option",
      options: [{ id: "south-option", label: "Southern option" }],
    },
  ];
  const moves = [vi.fn(), vi.fn()] as const;
  render(
    <LocaleProvider locale={locale}>
      <DndContext>
        <SortableContext items={rows.map((row) => row.id)}>
          <ul>
            {rows.map((row, index) => (
              <FieldRowItem
                key={row.id}
                row={row}
                isFirst={index === 0}
                isLast={index === rows.length - 1}
                onMove={moves[index] ?? moves[0]}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </LocaleProvider>,
  );
  return { names, rows, moves };
}

// DOM accessible-name and exact-row witnesses; native screen-reader acceptance remains separate.
describe("Field row action context", () => {
  it.each(["en", "de", "fa"] as const)(
    "keeps every full field name in localized controls and rename drafts in %s",
    (locale) => {
      const L = settingsMessagesForLocale(locale);
      const { names } = renderRowPair(locale);
      for (const name of names) {
        for (const action of [L.rename, L.archive, L.editOptions, L.moveUp, L.moveDown]) {
          expect(screen.getByRole("button", { name: `${action}: ${name}` })).toBeInTheDocument();
        }
        expect(screen.getByRole("switch", { name: `${L.important}: ${name}` })).toBeInTheDocument();
        expect(
          screen.getByRole("switch", { name: `${L.showInAddForm}: ${name}` }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: `${L.rename}: ${name}` }));
        expect(screen.getByRole("textbox", { name: `${L.rename}: ${name}` })).toHaveValue(name);
        expect(screen.getByRole("button", { name: `${L.save}: ${name}` })).toBeDisabled();
        expect(screen.getByRole("button", { name: `${L.cancel}: ${name}` })).toBeEnabled();
      }
      const input = screen.getByRole("textbox", { name: `${L.rename}: ${names[0]}` });
      fireEvent.change(input, { target: { value: "A revised draft" } });
      expect(input).toHaveAccessibleName(`${L.rename}: ${names[0]}`);
      expect(screen.getByRole("button", { name: `${L.save}: ${names[0]}` })).toBeEnabled();
      expect(screen.getByRole("button", { name: `${L.save}: ${names[1]}` })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: `${L.cancel}: ${names[0]}` }));
      expect(input).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${L.rename}: ${names[0]}` })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: `${L.rename}: ${names[1]}` })).toHaveValue(
        names[1],
      );
      fireEvent.click(screen.getByRole("button", { name: `${L.cancel}: ${names[1]}` }));
      expect(actions.renameDefAction).not.toHaveBeenCalled();
      expect(actions.archiveDefAction).not.toHaveBeenCalled();
      expect(actions.setDefFlagsAction).not.toHaveBeenCalled();
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
    },
  );

  it.each(["en", "de", "fa"] as const)(
    "routes named row actions to the intended field in %s",
    async (locale) => {
      const L = settingsMessagesForLocale(locale);
      const { names, moves } = renderRowPair(locale);
      fireEvent.click(screen.getByRole("button", { name: `${L.moveDown}: ${names[0]}` }));
      fireEvent.click(screen.getByRole("button", { name: `${L.moveUp}: ${names[1]}` }));
      expect(moves[0]).toHaveBeenCalledExactlyOnceWith("down");
      expect(moves[1]).toHaveBeenCalledExactlyOnceWith("up");
      expect(screen.getByRole("button", { name: `${L.moveUp}: ${names[0]}` })).toBeDisabled();
      expect(screen.getByRole("button", { name: `${L.moveDown}: ${names[1]}` })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: `${L.editOptions}: ${names[1]}` }));
      expect(screen.getByDisplayValue("Southern option")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Northern option")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: `${L.archive}: ${names[1]}` }));
      await waitFor(() => expect(actions.archiveDefAction).toHaveBeenCalledTimes(1));
      expect(actions.archiveDefAction).toHaveBeenCalledWith({ id: "field-south" }, "csrf");

      fireEvent.click(screen.getByRole("button", { name: `${L.rename}: ${names[0]}` }));
      fireEvent.change(screen.getByRole("textbox", { name: `${L.rename}: ${names[0]}` }), {
        target: { value: "Revised field" },
      });
      fireEvent.click(screen.getByRole("button", { name: `${L.save}: ${names[0]}` }));
      await waitFor(() => expect(actions.renameDefAction).toHaveBeenCalledTimes(1));
      expect(actions.renameDefAction).toHaveBeenCalledWith(
        { id: "field-north", name: "Revised field" },
        "csrf",
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("textbox", { name: `${L.rename}: ${names[0]}` }),
        ).not.toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("switch", { name: `${L.important}: ${names[1]}` }));
      await waitFor(() => expect(actions.setDefFlagsAction).toHaveBeenCalledTimes(1));
      expect(actions.setDefFlagsAction).toHaveBeenCalledWith(
        { id: "field-south", isImportant: true, showInAddForm: false },
        "csrf",
      );
      await waitFor(() =>
        expect(screen.getByRole("switch", { name: `${L.important}: ${names[1]}` })).toBeEnabled(),
      );
      expect(actions.archiveDefAction).toHaveBeenCalledTimes(1);
      expect(actions.renameDefAction).toHaveBeenCalledTimes(1);
      expect(report).not.toHaveBeenCalled();
    },
  );
});

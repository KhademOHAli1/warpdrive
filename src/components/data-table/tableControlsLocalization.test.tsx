// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DeleteSavedFilterConfirm } from "@/features/saved-filters/SavedFilterDelete";
import { SaveViewDialog } from "@/features/saved-filters/SaveViewDialog";
import type { SavedViewDefinition } from "@/features/saved-filters/savedView";
import { BulkActionBar } from "./BulkActionBar";
import { BulkDeleteButton } from "./BulkDeleteButton";
import { ColumnsMenuSortableList } from "./ColumnsMenuSortableList";

const { createSavedFilterAction } = vi.hoisted(() => ({ createSavedFilterAction: vi.fn() }));
vi.mock("@/features/saved-filters/serverActions", () => ({ createSavedFilterAction }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Persian table and saved-view controls", () => {
  it("localizes counts and accessible clear action while preserving children", () => {
    const clear = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <BulkActionBar count={12} onClear={clear}>
          <span>عملیات سفارشی</span>
        </BulkActionBar>
      </LocaleProvider>,
    );
    expect(screen.getByText("۱۲ مورد انتخاب شده")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "لغو انتخاب" }));
    expect(clear).toHaveBeenCalledOnce();
    expect(screen.getByText("عملیات سفارشی")).toBeInTheDocument();
  });
  it("confirms Persian counts and contextual entity nouns before deleting", () => {
    const confirm = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <BulkDeleteButton count={2} noun="person" nounPlural="people" onConfirm={confirm} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("۲ فرد حذف شود؟");
    expect(screen.getByRole("button", { name: "انصراف" })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "حذف افراد" }));
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("saves a localized default name without changing filter identifiers or values", async () => {
    createSavedFilterAction.mockResolvedValue({ ok: true, value: { id: "saved-fa" } });
    const definition: SavedViewDefinition = {
      combinator: "and" as const,
      conditions: [{ field: "primaryEmail", op: "contains", value: "acme@example.com" }],
    };
    const saved = vi.fn();
    const user = userEvent.setup();
    render(
      <LocaleProvider locale="fa">
        <SaveViewDialog
          targetEntity="person"
          definition={definition}
          onClose={vi.fn()}
          onSaved={saved}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("ذخیره نمای فعلی");
    await user.click(screen.getByRole("checkbox", { name: "اشتراک با همه" }));
    await user.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(createSavedFilterAction).toHaveBeenCalledWith(
      { name: "نمای بدون نام", targetEntity: "person", definition, isShared: true },
      "csrf",
    );
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-fa", definition }));
  });
  it("keeps the saved name and stable ID in a localized shared-delete confirmation", () => {
    const confirm = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <DeleteSavedFilterConfirm
          pending={{ id: "view-id", name: "Enterprise customers", isShared: true }}
          noun="view"
          onOpenChange={vi.fn()}
          onConfirm={confirm}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Enterprise customers");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("همه افرادی که به آن دسترسی دارند");
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(confirm).toHaveBeenCalledWith("view-id");
  });
});

it("preserves an unrecognized caller-supplied noun pair", () => {
  render(
    <LocaleProvider locale="fa">
      <BulkDeleteButton
        count={2}
        noun="invoice row"
        nounPlural="invoice rows"
        onConfirm={vi.fn()}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "حذف" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("۲ invoice rows حذف شود؟");
  expect(screen.getByRole("button", { name: "حذف invoice rows" })).toBeInTheDocument();
});
it("announces keyboard column moves using localized copy and caller display names", async () => {
  const reorder = vi.fn();
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <ColumnsMenuSortableList
        catalog={[
          { key: "internal-title-key", header: "نام مشتری", pinned: true, defaultVisible: true },
          { key: "internal-email-key", header: "Email / ایمیل", defaultVisible: true },
        ]}
        order={["internal-title-key", "internal-email-key"]}
        pinned="internal-title-key"
        onToggle={vi.fn()}
        onReorder={reorder}
      />
    </LocaleProvider>,
  );
  const handle = screen.getByRole("button", { name: "جابه‌جایی ستون Email / ایمیل" });
  expect(handle).toHaveAttribute("aria-roledescription", "ستون قابل جابه‌جایی");
  handle.focus();
  await user.keyboard("[Space]");
  expect(
    await screen.findByText("ستون «Email / ایمیل» برای جابه‌جایی انتخاب شد."),
  ).toBeInTheDocument();
  await user.keyboard("[Escape]");
  expect(await screen.findByText("جابه‌جایی ستون «Email / ایمیل» لغو شد.")).toBeInTheDocument();
  expect(reorder).not.toHaveBeenCalled();
});

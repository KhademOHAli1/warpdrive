// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WizardStepper } from "@/app/(app)/settings/import/WizardStepper";
import { Consent } from "@/app/oauth/authorize/consent";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { EditableHeading } from "@/features/inline-edit/EditableHeading";
import { CatalogLabelPicker } from "@/features/labels/CatalogLabelPicker";
import { PresenceAvatars } from "@/features/presence/ui/PresenceBar";
import { VersionBanner } from "@/features/release/ui/VersionBanner";
import { PageHeading } from "./PageHeading";

vi.mock("@/features/release/ui/useVersion", () => ({
  useVersion: () => ({
    data: {
      updateAvailable: true,
      latest: "v1.7.0",
      current: "1.6.0",
      releaseUrl: "https://github.com/sneg55/warpdrive/releases/tag/v1.7.0",
      releaseNotes: "Externally authored release notes",
    },
  }),
}));
vi.mock("@/features/presence/ui/usePresence", () => ({ usePresence: () => [] }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    labels: {
      listByTarget: {
        useQuery: () => ({ data: [{ id: "custom", name: "VIP ویژه", color: "green" }] }),
      },
    },
  },
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("localized shared utilities", () => {
  it("preserves consent decisions and external identities with clear Persian permission limits", () => {
    render(
      <LocaleProvider locale="fa">
        <Consent
          action="/oauth/authorize?csrf_token=fixed"
          clientName="برنامه ABC"
          redirectUri="https://example.org:8443/cb"
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent(
      "می‌خواهید یک برنامه را به warpdrive متصل کنید؟",
    );
    expect(screen.getByRole("heading")).not.toHaveTextContent("برنامه ABC");
    expect(screen.getByText(/امکان حذف رکوردها را ندارد/)).toHaveTextContent(
      "دسترسی آن را در تنظیمات لغو کنید",
    );
    expect(screen.getByTestId("consent-warning")).toHaveTextContent("درخواست را رد کنید");
    expect(screen.getByTestId("consent-client-name")).toHaveTextContent("برنامه ABC");
    expect(screen.getByTestId("consent-client-name").querySelector("bdi")).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(screen.getByTestId("consent-redirect-host").querySelector("bdi")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(screen.getByTestId("consent-redirect-host")).toHaveTextContent("example.org:8443");
    const approve = screen.getByRole("button", { name: "اجازهٔ دسترسی" });
    expect(approve).toHaveAttribute("name", "decision");
    expect(approve).toHaveAttribute("value", "approve");
    expect(approve.closest("form")).toHaveAttribute("action", "/oauth/authorize?csrf_token=fixed");
    expect(screen.getByRole("button", { name: "رد درخواست" })).toHaveAttribute("value", "deny");
  });

  it("translates release chrome, isolates ASCII versions and leaves release content intact", () => {
    render(
      <LocaleProvider locale="fa">
        <VersionBanner />
      </LocaleProvider>,
    );
    expect(screen.getByText("v1.7.0")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("1.6.0")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("link", { name: "مشاهده در GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/sneg55/warpdrive/releases/tag/v1.7.0",
    );
    fireEvent.click(screen.getByRole("button", { name: "نمایش توضیحات انتشار" }));
    expect(screen.getByText("Externally authored release notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "پنهان کردن توضیحات انتشار" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "بستن اعلان" }));
    expect(screen.queryByText("v1.7.0")).not.toBeInTheDocument();
  });

  it("formats presence overflow and announces what the count means without changing names", () => {
    render(
      <LocaleProvider locale="fa">
        <PresenceAvatars
          selfId="me"
          users={[
            { userId: "me", name: "من" },
            { userId: "1", name: "Alice علی" },
            { userId: "2", name: "ب" },
            { userId: "3", name: "ج" },
            { userId: "4", name: "د" },
            { userId: "5", name: "ه" },
          ]}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByLabelText("من")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Alice علی").querySelector("bdi")).toHaveTextContent("A");
    expect(screen.getByLabelText("۲ نفر دیگر در حال مشاهده‌اند")).toHaveTextContent("+۲");
  });

  it("respects a Latin numeral preference in Persian presence counts", () => {
    render(
      <LocaleProvider locale="fa" numberingSystem="latn">
        <PresenceAvatars
          selfId="me"
          users={Array.from({ length: 5 }, (_, i) => ({ userId: String(i), name: String(i) }))}
        />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("2 نفر دیگر در حال مشاهده‌اند")).toHaveTextContent("+2");
  });

  it("translates label controls while preserving administrator labels and submitted names", async () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <CatalogLabelPicker target="person" value={[]} onChange={onChange} />
      </LocaleProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ افزودن برچسب" }));
    expect(screen.getByRole("menu", { name: "+ افزودن برچسب" })).toHaveAttribute(
      "aria-label",
      "برچسب‌ها",
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: "VIP ویژه" }));
    expect(onChange).toHaveBeenCalledWith(["VIP ویژه"]);
    expect(screen.getByRole("menuitem", { name: "ایجاد برچسب جدید" })).toHaveAttribute(
      "href",
      "/settings/company/labels",
    );
  });

  it("translates breadcrumb accessibility and the whole heading edit phrase", () => {
    render(
      <LocaleProvider locale="fa">
        <PageHeading title="عنوان سفارشی" crumbs={[{ label: "نام خود کاربر" }]} />
        <EditableHeading title="ABC عنوان" label="نام سازمان" onCommit={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("navigation", { name: "مسیر صفحه" })).toHaveTextContent(
      "نام خود کاربر",
    );
    expect(screen.getByRole("heading", { name: "عنوان سفارشی" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ویرایش نام سازمان" }));
    expect(screen.getByRole("textbox", { name: "ویرایش نام سازمان" })).toHaveValue("ABC عنوان");
  });

  it("resolves import labels at render time and preserves transient-state mapping", () => {
    render(
      <LocaleProvider locale="fa">
        <WizardStepper step="validating" />
      </LocaleProvider>,
    );
    const current = screen.getByRole("listitem", { current: "step" });
    expect(current).toHaveTextContent("۲تطبیق ستون‌ها");
    expect(screen.getAllByRole("listitem").at(-1)).toHaveTextContent("۴ورود اطلاعات");
  });
});

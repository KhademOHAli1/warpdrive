// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { actionErrorContent } from "./actionError";
import { SearchTrigger } from "./SearchTrigger";
import { SearchResultsSkeleton } from "./skeletons";

afterEach(cleanup);

describe("Farsi application shell", () => {
  it("announces search loading in the active language", () => {
    render(
      <LocaleProvider locale="fa">
        <SearchResultsSkeleton />
      </LocaleProvider>,
    );
    expect(screen.getByRole("status", { name: "در حال جست‌وجو" })).toBeInTheDocument();
  });
  it("exposes the search action in the selected language", () => {
    render(
      <LocaleProvider locale="fa">
        <SearchTrigger />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "باز کردن جست‌وجو" })).toHaveTextContent(
      "جست‌وجو در فضای کاری…",
    );
  });

  it("explains a failed save in Farsi without requiring translated machine error IDs", () => {
    expect(actionErrorContent("unknown", "fa").title).toBe("انجام این کار ممکن نشد");
    expect(actionErrorContent("unknown", "fa").body).toContain("ذخیره نشد");
    expect(actionErrorContent("unknown", "en").title).toBe("Couldn't complete that action");
  });
});

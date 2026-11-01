// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { McpSetup } from "./McpSetup";

afterEach(cleanup);

it("previews and copies an actionable workflow without executing CRM writes", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<McpSetup endpoint="http://localhost:3150/api/mcp" />);
  await user.click(screen.getByRole("button", { name: "Review my pipeline" }));
  expect(screen.getByRole("region", { name: "Prompt preview" })).toHaveTextContent("stalled deals");
  await user.click(screen.getByRole("button", { name: "Copy prompt" }));
  expect(write).toHaveBeenCalledWith(expect.stringContaining("stalled deals"));
  expect(screen.getByRole("status")).toHaveTextContent("Paste it into");
  expect(screen.getByText(/separate read-only connection/)).toBeVisible();
});

it.each([
  { locale: "fa" as const, draft: "پیش‌نویس پیام پیگیری", body: "بدون ارسال پیام" },
  { locale: "de" as const, draft: "Follow-up entwerfen", body: "ohne die Nachricht zu senden" },
])("provides natural workflow instructions in $locale", async ({ locale, draft, body }) => {
  render(
    <LocaleProvider locale={locale}>
      <McpSetup endpoint={null} />
    </LocaleProvider>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: draft }));
  expect(screen.getByRole("blockquote")).toHaveTextContent(body);
});

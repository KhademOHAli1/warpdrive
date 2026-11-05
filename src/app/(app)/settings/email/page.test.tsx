// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getActor } = vi.hoisted(() => ({
  getActor: vi.fn(() => ({ id: "actor-1", type: "regular", flags: new Set<string>() })),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/settingsMessages.server", async () => {
  const { settingsMessagesForLocale } = await import("@/features/identity/settingsMessages");
  return { getServerSettingsMessages: () => Promise.resolve(settingsMessagesForLocale("en")) };
});
vi.mock("@/server/trpc/context", () => ({
  createContext: vi.fn(() => Promise.resolve({ actor: getActor() })),
}));
vi.mock("@/features/email/emailAuthoringReads", () => ({
  listSignatures: vi.fn(() => Promise.resolve([])),
  listTemplatesForSettings: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./TemplatesSettingsClient", () => ({
  TemplatesSettingsClient: ({ canShare }: { canShare: boolean }) => (
    <div data-can-share={String(canShare)}>Templates client</div>
  ),
}));
vi.mock("./SignaturesSettingsClient", () => ({
  SignaturesSettingsClient: () => <div>Signatures client</div>,
}));

afterEach(cleanup);

describe("EmailSettingsPage", () => {
  it("renders the settings breadcrumb", async () => {
    const { default: EmailSettingsPage } = await import("./page");
    render(await EmailSettingsPage());

    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(
      screen.getByRole("heading", { level: 1, name: "Templates & signatures" }),
    ).not.toBeNull();
  });

  it.each([
    { type: "admin", flags: [], canShare: true },
    { type: "regular", flags: ["filter.share"], canShare: true },
    { type: "regular", flags: [], canShare: false },
  ])("sets sharing to $canShare for $type with flags $flags", async ({ type, flags, canShare }) => {
    getActor.mockReturnValueOnce({ id: "actor-1", type, flags: new Set(flags) });
    const { default: EmailSettingsPage } = await import("./page");
    render(await EmailSettingsPage());

    expect(screen.getByText("Templates client").getAttribute("data-can-share")).toBe(
      String(canShare),
    );
  });
});

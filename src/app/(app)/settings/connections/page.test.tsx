// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IntegrationHubProps } from "@/features/integrations/IntegrationHub";

const env = { MCP_ENABLED: true, BASE_URL: "https://crm.example.com" };
const listConnections = vi.fn(() => Promise.resolve([]));
const hub = vi.fn((props: IntegrationHubProps) => (
  <div data-testid="integration-hub" data-endpoint={props.endpoint ?? "disabled"} />
));
vi.mock("@/config/env", () => ({ env }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/settingsMessages.server", async () => {
  const { settingsMessagesForLocale } = await import("@/features/identity/settingsMessages");
  return { getServerSettingsMessages: () => Promise.resolve(settingsMessagesForLocale("en")) };
});
vi.mock("@/features/i18n/server", async () => {
  const { createAppTranslator } = await import("@/features/i18n/catalog");
  return { getAppTranslations: () => Promise.resolve(createAppTranslator("en", "integrations")) };
});
vi.mock("@/features/integrations/IntegrationHub", () => ({ IntegrationHub: hub }));
vi.mock("@/features/integrations/service", () => ({
  listServiceConnections: () => Promise.resolve([]),
}));
vi.mock("@/features/integrations/slack", () => ({ slackConfiguration: () => null }));
vi.mock("@/features/email/mailboxOwnership", () => ({
  getActorMailboxStatus: () => Promise.resolve(null),
}));
vi.mock("../email-sync/EmailSyncClient", () => ({ EmailSyncClient: () => <div /> }));
vi.mock("@/server/trpc/context", () => ({
  createContext: () =>
    Promise.resolve({ db: {}, actor: { id: "synthetic-user", type: "regular" } }),
}));
vi.mock("@/server/trpc/root", () => ({ createCaller: () => ({ oauth: { listConnections } }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("passes the configured MCP endpoint to the integration hub", async () => {
  env.MCP_ENABLED = true;
  const { default: Page } = await import("./page");
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(screen.getByTestId("integration-hub").getAttribute("data-endpoint")).toBe(
    "https://crm.example.com/api/mcp",
  );
});

it("keeps the hub discoverable without trusting a success parameter when no account is connected", async () => {
  env.MCP_ENABLED = false;
  const { default: Page } = await import("./page");
  render(
    await Page({ searchParams: Promise.resolve({ tab: "connections", result: "connected" }) }),
  );
  expect(screen.getByTestId("integration-hub").getAttribute("data-endpoint")).toBe("disabled");
  expect(hub.mock.calls[0]?.[0]).toMatchObject({
    initialTab: "connections",
    callbackResult: undefined,
    isAdmin: false,
    slackConfigured: false,
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActorMailboxStatus } from "@/features/email/mailboxOwnership";
import type { IntegrationHubProps } from "@/features/integrations/IntegrationHub";
import type { MailboxView } from "../email-sync/EmailSyncClient";

const env = { MCP_ENABLED: true, BASE_URL: "https://crm.example.com" };
const listConnections = vi.fn(() => Promise.resolve([]));
const gmailMailboxStatus = vi.fn<() => Promise<ActorMailboxStatus | null>>(() =>
  Promise.resolve(null),
);
const gmailClient = vi.fn(({ mailbox }: { mailbox: MailboxView | null }) => (
  <div data-testid="gmail-connection">{mailbox?.emailAddress ?? "unlinked"}</div>
));
const hub = vi.fn((props: IntegrationHubProps) => (
  <div data-testid="integration-hub" data-endpoint={props.endpoint ?? "disabled"}>
    {props.gmail}
  </div>
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
vi.mock("@/frontend/reads", () => ({
  getConnections: async () => ({
    services: [],
    mailbox: await gmailMailboxStatus(),
    slackConfigured: false,
  }),
}));
vi.mock("../email-sync/EmailSyncClient", () => ({ EmailSyncClient: gmailClient }));
vi.mock("@/frontend/context", () => ({
  getFrontendConfig: async () => {
    const { env } = await import("@/config/env");
    return {
      ...env,
      GMAIL_CONFIGURED: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    };
  },

  createContext: () =>
    Promise.resolve({ db: {}, actor: { id: "synthetic-user", type: "regular" } }),
}));
vi.mock("@/frontend/trpc", () => ({ createCaller: () => ({ oauth: { listConnections } }) }));
beforeEach(() => {
  gmailMailboxStatus.mockResolvedValue(null);
});
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

it.each(["connected", "disconnected", "error"] as const)(
  "passes the owner's Gmail %s status consistently to the hub and Gmail controls",
  async (status) => {
    const gmail: ActorMailboxStatus = {
      id: "owned-gmail",
      emailAddress: "own@gmail.test",
      status,
      paused: status === "connected",
      lastSyncAt: new Date("2026-07-01T10:00:00Z"),
      lastCheckedAt: new Date("2026-07-01T10:12:00Z"),
      lastErrorId: status === "connected" ? null : "E_GMAIL_002",
    };
    gmailMailboxStatus.mockResolvedValue(gmail);
    const { default: Page } = await import("./page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(gmailMailboxStatus).toHaveBeenCalledOnce();
    expect(hub.mock.calls[0]?.[0].mailbox).toEqual({ status });
    expect(gmailClient.mock.calls[0]?.[0].mailbox).toEqual({
      id: gmail.id,
      emailAddress: gmail.emailAddress,
      status,
      paused: gmail.paused,
      lastSyncAtIso: "2026-07-01T10:00:00.000Z",
      lastCheckedAtIso: "2026-07-01T10:12:00.000Z",
      errorCode: status === "connected" ? undefined : "authentication",
    });
    expect(screen.getByTestId("gmail-connection")).toHaveTextContent("own@gmail.test");
  },
);

it("passes null to the hub and Gmail controls when Core projects no Gmail account", async () => {
  const { default: Page } = await import("./page");
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(gmailMailboxStatus).toHaveBeenCalledOnce();
  expect(hub.mock.calls[0]?.[0].mailbox).toBeNull();
  expect(gmailClient.mock.calls[0]?.[0].mailbox).toBeNull();
  expect(screen.getByTestId("gmail-connection")).toHaveTextContent("unlinked");
});

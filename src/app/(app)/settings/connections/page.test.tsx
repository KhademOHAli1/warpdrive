// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActorMailboxStatus } from "@/features/email/mailboxOwnership";
import type { IntegrationHubProps } from "@/features/integrations/IntegrationHub";
import type { MailboxView } from "../email-sync/EmailSyncClient";

const env = { MCP_ENABLED: true, BASE_URL: "https://crm.example.com" };
const listConnections = vi.fn(() => Promise.resolve([]));
const defaultMailbox = vi.fn<
  (
    db: unknown,
    actorId: string,
    signal: AbortSignal,
  ) => Promise<{ id: string; emailAddress: string } | null>
>(() => Promise.resolve(null));
const gmailMailboxStatus = vi.fn<
  (db: unknown, actorId: string, signal: AbortSignal) => Promise<ActorMailboxStatus | null>
>(() => Promise.resolve(null));
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
vi.mock("@/features/email/mailboxOwnership", () => ({
  getActorMailbox: defaultMailbox,
  getActorGmailMailboxStatus: gmailMailboxStatus,
}));
vi.mock("../email-sync/EmailSyncClient", () => ({ EmailSyncClient: gmailClient }));
vi.mock("@/server/trpc/context", () => ({
  createContext: () =>
    Promise.resolve({ db: {}, actor: { id: "synthetic-user", type: "regular" } }),
}));
vi.mock("@/server/trpc/root", () => ({ createCaller: () => ({ oauth: { listConnections } }) }));
beforeEach(() => {
  defaultMailbox.mockResolvedValue(null);
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
      lastSyncAt: new Date("2026-07-01T10:00:00Z"),
      lastErrorId: status === "connected" ? null : "E_GMAIL_002",
    };
    defaultMailbox.mockResolvedValue({
      id: "default-imap",
      emailAddress: "default@imap.test",
    });
    gmailMailboxStatus.mockResolvedValue(gmail);
    const { default: Page } = await import("./page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(gmailMailboxStatus).toHaveBeenCalledWith({}, "synthetic-user", expect.any(AbortSignal));
    expect(defaultMailbox).not.toHaveBeenCalled();
    expect(hub.mock.calls[0]?.[0].mailbox).toEqual({ status });
    expect(gmailClient.mock.calls[0]?.[0].mailbox).toEqual({
      id: gmail.id,
      emailAddress: gmail.emailAddress,
      status,
      lastSyncAtIso: "2026-07-01T10:00:00.000Z",
      lastErrorId: gmail.lastErrorId,
    });
    expect(screen.getByTestId("gmail-connection")).toHaveTextContent("own@gmail.test");
  },
);

it("passes null to the hub and Gmail controls when the owner has only IMAP", async () => {
  defaultMailbox.mockResolvedValue({
    id: "default-imap",
    emailAddress: "only@imap.test",
  });
  const { default: Page } = await import("./page");
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(gmailMailboxStatus).toHaveBeenCalledWith({}, "synthetic-user", expect.any(AbortSignal));
  expect(defaultMailbox).not.toHaveBeenCalled();
  expect(hub.mock.calls[0]?.[0].mailbox).toBeNull();
  expect(gmailClient.mock.calls[0]?.[0].mailbox).toBeNull();
  expect(screen.getByTestId("gmail-connection")).toHaveTextContent("unlinked");
});

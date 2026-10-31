// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { IntegrationHub } from "./IntegrationHub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  connectSlackAction: vi.fn(),
  configureSlackAction: vi.fn(),
  disconnectSlackAction: vi.fn(),
  slackChannelsAction: vi.fn(),
  testSlackAction: vi.fn(),
}));
vi.mock("@/app/(app)/settings/connections/ConnectionsClient", () => ({
  ConnectionsClient: () => <p>Authorized clients</p>,
}));
afterEach(cleanup);

const props = {
  endpoint: null,
  slackConfigured: false,
  isAdmin: false,
  serviceConnections: [],
  aiConnections: [],
  gmail: <p>Gmail account controls</p>,
};

it("keeps AI onboarding discoverable when MCP is disabled and explains why", async () => {
  render(<IntegrationHub {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "AI clients" }));
  expect(screen.getByRole("status")).toHaveTextContent("not been enabled");
  expect(screen.getByRole("tab", { name: "ChatGPT" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Claude" })).toBeVisible();
});

it("does not offer a working connector or installation for a planned provider", async () => {
  render(<IntegrationHub {...props} />);
  expect(screen.queryByRole("heading", { name: "Zoom" })).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /Explore planned integrations/ }));
  await userEvent.setup().click(screen.getByRole("button", { name: "View roadmap: Zoom" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("not available yet");
  expect(screen.queryByRole("button", { name: "Connect account" })).not.toBeInTheDocument();
});

it("opens real connections first and keeps recovery ahead of discovery", async () => {
  render(
    <IntegrationHub
      {...props}
      serviceConnections={[
        {
          id: "slack-1",
          provider: "slack",
          accountName: "Product team",
          status: "revocation-pending",
          settings: {},
          lastCheckedAt: null,
        },
      ]}
    />,
  );
  expect(screen.getByRole("tab", { name: /My connections/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent("Product team");
  expect(screen.queryByRole("heading", { name: "Zoom" })).not.toBeInTheDocument();
});

it("lets an empty workspace discover supported apps without a wall of roadmap cards", () => {
  render(<IntegrationHub {...props} />);
  expect(screen.getByRole("tab", { name: /Browse integrations/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("heading", { name: "Available integrations" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Dropbox" })).not.toBeInTheDocument();
});

it("explains both missing Slack configuration and administrator access", async () => {
  render(<IntegrationHub {...props} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Setup guide: Slack" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("configure the Slack OAuth app");
  expect(screen.getByRole("button", { name: "Connect account" })).toBeDisabled();
});

it.each([
  {
    locale: "fa" as const,
    search: "جست‌وجو در اتصال‌ها",
    button: "راهنمای راه‌اندازی: Slack",
    text: "مدیر سرور",
  },
  {
    locale: "de" as const,
    search: "Integrationen suchen",
    button: "Einrichtungsanleitung: Slack",
    text: "Serveradministrator",
  },
])(
  "supports localized searching and setup details in $locale",
  async ({ locale, search, button, text }) => {
    render(
      <LocaleProvider locale={locale}>
        <IntegrationHub {...props} />
      </LocaleProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: search }), "Slack");
    expect(screen.queryByRole("heading", { name: "Zoom" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: button }));
    expect(screen.getByRole("dialog")).toHaveTextContent(text);
  },
);

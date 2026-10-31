// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { configureSlackAction, disconnectSlackAction, slackChannelsAction } from "./actions";
import { SlackConnection } from "./SlackConnection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  connectSlackAction: vi.fn(),
  configureSlackAction: vi.fn(),
  disconnectSlackAction: vi.fn(),
  slackChannelsAction: vi.fn(),
  testSlackAction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const connection = {
  id: "connection-1",
  provider: "slack",
  accountName: "Design team",
  status: "connected",
  settings: { channelId: "C001", channelName: "customer-updates" },
  lastCheckedAt: "2026-10-31T09:00:00Z",
  ownerName: "Workspace admin",
  connectedAt: "2026-10-30T09:00:00Z",
  scopes: ["chat:write", "channels:read"],
};

it("shows the workspace, actual authorizer and granted scopes without inventing sync history", async () => {
  render(<SlackConnection connection={connection} isAdmin />);
  expect(screen.getByText("Workspace admin")).toBeVisible();
  expect(screen.getByText("#customer-updates")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Granted access" }));
  expect(screen.getByText("chat:write")).toBeVisible();
  expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
});

it("lets a disconnected workspace enter the reconnect flow", async () => {
  const reconnect = vi.fn();
  render(
    <SlackConnection
      connection={{ ...connection, status: "disconnected" }}
      isAdmin
      onReconnect={reconnect}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Reconnect" }));
  expect(reconnect).toHaveBeenCalledOnce();
});

it("confirms pending removal and reports an upstream outage without pretending it finished", async () => {
  vi.mocked(disconnectSlackAction).mockResolvedValue({ ok: true, value: false });
  render(<SlackConnection connection={{ ...connection, status: "revocation-pending" }} isAdmin />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Retry removal" }));
  expect(disconnectSlackAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(disconnectSlackAction).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("could not confirm revocation");
});

it("loads joined channels before saving and surfaces reauthentication", async () => {
  vi.mocked(slackChannelsAction).mockResolvedValue({
    ok: true,
    value: [{ id: "C001", name: "customer-updates" }],
  });
  vi.mocked(configureSlackAction).mockResolvedValue({ ok: false, error: "freshAuthentication" });
  render(<SlackConnection connection={connection} isAdmin />);
  const user = userEvent.setup();
  expect(screen.getByRole("button", { name: "Save channel" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Load channels" }));
  await user.click(screen.getByRole("button", { name: "Save channel" }));
  expect(configureSlackAction).toHaveBeenCalledWith(null, {
    id: "connection-1",
    channelId: "C001",
  });
  expect(screen.getByRole("alert")).toHaveTextContent("sign in again");
});

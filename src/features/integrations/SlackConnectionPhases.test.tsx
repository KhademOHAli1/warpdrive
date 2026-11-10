// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

function expectPreservedFacts() {
  expect(screen.getByRole("heading", { name: "Design team" })).toBeVisible();
  expect(screen.getByText("Workspace admin")).toBeVisible();
  expect(screen.getByText("#customer-updates")).toBeVisible();
}

function expectNoActiveCredentialControls() {
  for (const name of ["Load channels", "Test connection"]) {
    const button = screen.queryByRole("button", { name, exact: true });
    if (button !== null) expect(button).toBeDisabled();
  }
}

it.each(["reconnecting", "scope-review-pending", "reauthorization-required", "expired"])(
  "preserves account facts without Connected or active credential controls for %s",
  (status) => {
    render(<SlackConnection connection={{ ...connection, status }} isAdmin />);
    expectPreservedFacts();
    expectNoActiveCredentialControls();
    expect(screen.queryByText("Connected", { exact: true })).not.toBeInTheDocument();
  },
);

it("retains the Connected badge and normal controls for a connected account", () => {
  render(<SlackConnection connection={connection} isAdmin />);
  expectPreservedFacts();
  expect(screen.getByText("Connected", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Load channels", exact: true })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Test connection", exact: true })).toBeEnabled();
});

it("retains Needs attention and Retry removal for an existing pending revocation", () => {
  render(<SlackConnection connection={{ ...connection, status: "revocation-pending" }} isAdmin />);
  expectPreservedFacts();
  expectNoActiveCredentialControls();
  expect(screen.getByText("Needs attention", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry removal", exact: true })).toBeEnabled();
  expect(screen.queryByText("Connected", { exact: true })).not.toBeInTheDocument();
});

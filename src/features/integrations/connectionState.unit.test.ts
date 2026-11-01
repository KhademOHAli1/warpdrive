import { expect, it } from "vitest";
import { INTEGRATIONS, type IntegrationId } from "./catalog";
import { type ConnectionContext, connectionState } from "./connectionState";

const base: ConnectionContext = {
  endpoint: null,
  slackConfigured: false,
  gmailConfigured: false,
  mailbox: null,
  services: [],
};
function state(id: IntegrationId, patch: Partial<ConnectionContext> = {}) {
  const item = INTEGRATIONS.find((entry) => entry.id === id);
  if (!item) throw new Error("Missing fixture");
  return connectionState(item, { ...base, ...patch });
}
it("does not confuse server configuration with an authorized account", () => {
  expect(state("slack", { slackConfigured: true })).toMatchObject({
    status: "ready",
    action: "connect",
  });
  expect(state("slack")).toMatchObject({ status: "needsSetup", action: "setupGuide" });
  expect(state("chatgpt")).toMatchObject({ status: "disabled", action: "setupGuide" });
  expect(state("chatgpt", { endpoint: "http://localhost/api/mcp" })).toMatchObject({
    status: "ready",
    action: "setupAi",
  });
});
it("routes Slack setup, active, disconnected and revocation states to the right next action", () => {
  expect(state("slack", { services: [{ status: "connected", settings: {} }] })).toMatchObject({
    status: "finishSetup",
    action: "finishSetup",
  });
  expect(
    state("slack", { services: [{ status: "connected", settings: { channelId: "C001" } }] }),
  ).toMatchObject({ status: "connected", action: "manage" });
  expect(state("slack", { services: [{ status: "disconnected", settings: {} }] })).toMatchObject({
    status: "disconnected",
    action: "reconnect",
  });
  expect(
    state("slack", { services: [{ status: "revocation-pending", settings: {} }] }),
  ).toMatchObject({ status: "needsAttention", action: "manage" });
});
it("shows mailbox authorization errors and planned providers honestly", () => {
  expect(state("gmail", { mailbox: { status: "error" } })).toMatchObject({
    status: "needsAttention",
    action: "reconnect",
  });
  expect(state("gmail", { mailbox: { status: "connected" } })).toMatchObject({
    status: "connected",
    action: "manage",
  });
  expect(state("gmail", { mailbox: { status: "disconnected" } })).toMatchObject({
    status: "disconnected",
    action: "reconnect",
  });
  expect(state("zoom")).toMatchObject({ status: "planned", action: "explorePlanned" });
});

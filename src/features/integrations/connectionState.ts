import type { Integration } from "./catalog";

export interface ConnectionContext {
  endpoint: string | null;
  slackConfigured: boolean;
  gmailConfigured: boolean;
  mailbox: { status: string } | null;
  services: { status: string; settings: { channelId?: string } }[];
}

export type ConnectionStatus =
  | "ready"
  | "planned"
  | "disabled"
  | "needsSetup"
  | "finishSetup"
  | "connected"
  | "disconnected"
  | "needsAttention";
export type ConnectionAction =
  | "connect"
  | "setupGuide"
  | "setupAi"
  | "finishSetup"
  | "manage"
  | "reconnect"
  | "explorePlanned";

export function connectionState(
  item: Integration,
  context: ConnectionContext,
): { status: ConnectionStatus; action: ConnectionAction } {
  if (item.delivery === "planned") return { status: "planned", action: "explorePlanned" };
  if (item.delivery === "mcp")
    return context.endpoint === null
      ? { status: "disabled", action: "setupGuide" }
      : { status: "ready", action: "setupAi" };
  if (item.delivery === "gmail") {
    if (context.mailbox?.status === "connected") return { status: "connected", action: "manage" };
    if (context.mailbox?.status === "error")
      return { status: "needsAttention", action: "reconnect" };
    if (context.mailbox !== null) return { status: "disconnected", action: "reconnect" };
    return context.gmailConfigured
      ? { status: "ready", action: "connect" }
      : { status: "needsSetup", action: "setupGuide" };
  }
  const { services } = context;
  if (services.some((row) => row.status === "revocation-pending"))
    return { status: "needsAttention", action: "manage" };
  if (services.some((row) => row.status === "connected" && !row.settings.channelId))
    return { status: "finishSetup", action: "finishSetup" };
  if (services.some((row) => row.status === "connected"))
    return { status: "connected", action: "manage" };
  if (services.length > 0) return { status: "disconnected", action: "reconnect" };
  return context.slackConfigured
    ? { status: "ready", action: "connect" }
    : { status: "needsSetup", action: "setupGuide" };
}

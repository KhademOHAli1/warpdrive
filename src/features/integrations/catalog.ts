export const INTEGRATION_CATEGORIES = [
  "all",
  "ai",
  "communication",
  "calendar",
  "automation",
  "files",
  "business",
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

const integrationDefinitions = [
  { id: "chatgpt", name: "ChatGPT", category: "ai", delivery: "mcp" },
  { id: "claude", name: "Claude", category: "ai", delivery: "mcp" },
  { id: "other-mcp", name: "MCP", category: "ai", delivery: "mcp" },
  { id: "gmail", name: "Gmail", category: "communication", delivery: "gmail" },
  { id: "slack", name: "Slack", category: "communication", delivery: "slack" },
  { id: "google-calendar", name: "Google Calendar", category: "calendar", delivery: "planned" },
  { id: "microsoft365", name: "Microsoft 365", category: "calendar", delivery: "planned" },
  { id: "zoom", name: "Zoom", category: "calendar", delivery: "planned" },
  { id: "n8n", name: "n8n", category: "automation", delivery: "planned" },
  { id: "make", name: "Make", category: "automation", delivery: "planned" },
  { id: "zapier", name: "Zapier", category: "automation", delivery: "planned" },
  { id: "google-drive", name: "Google Drive", category: "files", delivery: "planned" },
  { id: "onedrive", name: "OneDrive", category: "files", delivery: "planned" },
  { id: "dropbox", name: "Dropbox", category: "files", delivery: "planned" },
  { id: "github", name: "GitHub", category: "business", delivery: "planned" },
  { id: "linear", name: "Linear", category: "business", delivery: "planned" },
  { id: "jira", name: "Jira", category: "business", delivery: "planned" },
  { id: "calendly", name: "Calendly", category: "calendar", delivery: "planned" },
  { id: "cal-com", name: "Cal.com", category: "calendar", delivery: "planned" },
  { id: "whatsapp", name: "WhatsApp Business", category: "communication", delivery: "planned" },
  { id: "stripe", name: "Stripe", category: "business", delivery: "planned" },
] as const;

type IntegrationDefinition = (typeof integrationDefinitions)[number];

function describeIntegration<T extends IntegrationDefinition>(provider: T) {
  return {
    ...provider,
    // Local implementation does not imply server configuration or a live provider grant.
    availability: provider.delivery === "planned" ? ("planned" as const) : ("local" as const),
    authTypes: provider.delivery === "planned" ? ([] as const) : (["oauth2"] as const),
    asset: provider.id === "other-mcp" ? null : (`/integrations/${provider.id}.svg` as const),
    descriptionKey: `providers.${provider.id}.description` as const,
  };
}

export const INTEGRATIONS = integrationDefinitions.map(describeIntegration);

export type Integration = (typeof INTEGRATIONS)[number];
export type IntegrationId = Integration["id"];

export function filterIntegrations(
  query: string,
  category: IntegrationCategory,
  descriptions: Record<IntegrationId, string>,
): Integration[] {
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[\s\u200c]+/g, " ")
      .toLocaleLowerCase()
      .trim();
  const normalized = normalize(query);
  return INTEGRATIONS.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      normalize(`${item.name} ${descriptions[item.id]}`).includes(normalized),
  );
}

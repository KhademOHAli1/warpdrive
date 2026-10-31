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

export const INTEGRATIONS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    category: "ai",
    delivery: "mcp",
    mark: "C",
    color: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  },
  {
    id: "claude",
    name: "Claude",
    category: "ai",
    delivery: "mcp",
    mark: "C",
    color: "bg-orange-600/10 text-orange-700 dark:text-orange-400",
  },
  {
    id: "other-mcp",
    name: "MCP",
    category: "ai",
    delivery: "mcp",
    mark: "M",
    color: "bg-muted text-foreground",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "communication",
    delivery: "gmail",
    mark: "G",
    color: "bg-red-600/10 text-red-700 dark:text-red-400",
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    delivery: "slack",
    mark: "S",
    color: "bg-purple-600/10 text-purple-700 dark:text-purple-400",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "calendar",
    delivery: "planned",
    mark: "G",
    color: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
  },
  {
    id: "microsoft365",
    name: "Microsoft 365",
    category: "calendar",
    delivery: "planned",
    mark: "M",
    color: "bg-sky-600/10 text-sky-700 dark:text-sky-400",
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "calendar",
    delivery: "planned",
    mark: "Z",
    color: "bg-blue-600/10 text-blue-700 dark:text-blue-400",
  },
  {
    id: "automation",
    name: "n8n · Make · Zapier",
    category: "automation",
    delivery: "planned",
    mark: "A",
    color: "bg-amber-600/10 text-amber-700 dark:text-amber-400",
  },
  {
    id: "storage",
    name: "Google Drive · OneDrive · Dropbox",
    category: "files",
    delivery: "planned",
    mark: "F",
    color: "bg-green-600/10 text-green-700 dark:text-green-400",
  },
  {
    id: "delivery",
    name: "GitHub · Linear · Jira",
    category: "business",
    delivery: "planned",
    mark: "D",
    color: "bg-violet-600/10 text-violet-700 dark:text-violet-400",
  },
  {
    id: "booking",
    name: "Calendly · Cal.com",
    category: "calendar",
    delivery: "planned",
    mark: "B",
    color: "bg-teal-600/10 text-teal-700 dark:text-teal-400",
  },
  {
    id: "messaging",
    name: "WhatsApp Business · Telephony",
    category: "communication",
    delivery: "planned",
    mark: "W",
    color: "bg-lime-600/10 text-lime-700 dark:text-lime-400",
  },
  {
    id: "commerce",
    name: "Stripe · Accounting · E-signatures",
    category: "business",
    delivery: "planned",
    mark: "P",
    color: "bg-indigo-600/10 text-indigo-700 dark:text-indigo-400",
  },
] as const;

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

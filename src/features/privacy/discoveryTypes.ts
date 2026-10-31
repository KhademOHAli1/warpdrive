import type { SQL } from "drizzle-orm";

export const DISCOVERY_ADAPTER_TABLES = [
  "activities",
  "activity_guests",
  "activity_participants",
  "auth_users",
  "change_logs",
  "comments",
  "custom_field_defs",
  "deal_participants",
  "deals",
  "email_drafts",
  "email_messages",
  "email_threads",
  "files",
  "leads",
  "notes",
  "organizations",
  "persons",
  "users",
] as const;
export type DiscoveryStore = (typeof DISCOVERY_ADAPTER_TABLES)[number];
export type DiscoverySubject = { kind: "contact" | "user"; referenceId: string };
export type DiscoveryConfidence = "exact" | "linked" | "ambiguous";
export interface DiscoveryRow {
  id: string;
  relation: string;
  confidence: DiscoveryConfidence;
}
export interface DiscoveryCandidate {
  store: DiscoveryStore;
  recordId: string;
  provenance: { relation: string; source: string };
  confidence: DiscoveryConfidence;
  reviewRequired: true;
}
export interface DiscoveryAdapter {
  store: DiscoveryStore;
  source: string;
  query: (subject: DiscoverySubject) => SQL;
}

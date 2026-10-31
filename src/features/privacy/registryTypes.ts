export type InventoryKind =
  | "table"
  | "writer"
  | "queue"
  | "objectNamespace"
  | "external"
  | "browserStore"
  | "derived"
  | "log"
  | "backup"
  | "sourceReview";
export interface InventorySource {
  path: string;
  source: string;
}
export interface DiscoveredInventoryItem {
  id: string;
  kind: InventoryKind;
  source: string;
}
export type LifecycleOperation =
  | "discovery"
  | "export"
  | "rectification"
  | "restriction"
  | "erasure"
  | "retention";
export interface CapabilityDisposition {
  status: "unsupported" | "review_required" | "supported";
  reason: string;
  task: string;
}
export interface RegistryEntry {
  ids: string[];
  owner: string;
  categories: string[];
  subjectRelation: string;
  purpose: string;
  disclosure: string;
  retention: string;
  externalEffects: string;
  proof: string;
  capabilities: Record<LifecycleOperation, CapabilityDisposition>;
}
export interface PrivacyRegistry {
  version: number;
  entries: RegistryEntry[];
}

export interface InventoryClassification {
  owner: string;
  categories: string[];
  subjectRelation: string;
  purpose: string;
  disclosure: string;
  retention: string;
  externalEffects: string;
  erasureTask: string;
}

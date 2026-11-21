import type { CatalogError, CatalogIntent, CatalogResult } from "../contracts";

export type { CatalogIntent } from "../contracts";
export type CatalogWriteError = CatalogError | "transport";
export type CatalogSave = (
  intent: CatalogIntent,
) => Promise<CatalogResult | { ok: false; error: "transport" }>;
export type CatalogEditorProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: CatalogSave;
};

export const IMPORT_SOURCES = ["csv", "pipedrive"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const DEFAULT_IMPORT_SOURCE: ImportSource = "csv";

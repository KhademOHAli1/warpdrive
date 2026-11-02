import type { InventoryClassification } from "./registryTypes";

export const exportStorageClassification: InventoryClassification = {
  owner: "privacy export object storage",
  categories: [
    "export archive bytes",
    "opaque artifact/attempt/version/upload references",
    "multipart staging",
    "transient upload state",
    "local integrity receipts",
    "storage credential inputs",
    "reviewed manifest snapshots and staging repair references",
  ],
  subjectRelation:
    "References locate storage attempts and versions, not a subject or disclosure authority. Archive contents can concern multiple people; the caller must establish reviewed source scope.",
  purpose:
    "Compose a reviewed metadata snapshot and real archive codec with private storage staging; stream bounded multipart uploads, compare locally measured bytes/SHA-256 to a caller receipt, check completion version/HEAD size, and provide exact-version reads/removal and bounded inspection.",
  disclosure:
    "Internal storage only. The caller must establish current authority, approved scope and private storage/access controls. No authentication, publication, presigned delivery or archive encryption is supplied. Credentials and raw driver responses are excluded from routine results.",
  retention:
    "Objects and incomplete uploads persist until explicit removal/abort. No scheduled expiry, automatic abort, durable repair/job state, retention policy or backup disposal is implemented. Targeted absence does not prove removal of other versions, markers, replicas, backups or a subject's data.",
  externalEffects:
    "Credential-bearing MinIO SDK operations use configured HTTP/HTTPS with cancellation, deadlines and disabled SDK retries: multipart initiation/upload/completion/abort, version reads/removal and listing. HTTPS is permitted, not required. Local hashing/Map updates are separate from remote mutations; neither local SHA nor version/size HEAD independently verifies remote content.",
  erasureTask: "DPL-23",
};

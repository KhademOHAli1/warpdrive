import { classifyInventory } from "./registryClassification";
import { migrationIds1 } from "./registryIdsMigrations1";

export const migrationInventoryEntry = classifyInventory(migrationIds1, {
  owner: "installation migrations",
  categories: [
    "versioned SQL source",
    "migration digests and timestamps",
    "schema metadata",
    "operator diagnostics",
  ],
  subjectRelation:
    "A migration receipt describes installed source history, not a data subject or case scope. Existing application rows retain their own subject and lifecycle boundaries.",
  purpose:
    "Load canonical repository SQL, reject divergent installed histories, and apply admitted forward migrations and normal ledger receipts in one fenced transaction.",
  disclosure:
    "Source files and receipt hashes grant no permission to disclose application data, secrets or connection credentials. Failed-query diagnostics inherit installation log access restrictions.",
  retention:
    "Canonical SQL and the database ledger are installation history. A subject case cannot erase, reorder or synthesize migration receipts. Operator log, backup and restore lifecycles remain separately reviewed.",
  externalEffects:
    "Reads versioned journal/SQL files and queries PostgreSQL catalogs and ledger. The dynamic SQL writer executes only those loaded migration statements; digest update is an in-memory SHA-256 operation. No provider, mail, object or subject-erasure action is introduced.",
  erasureTask: "DPL-35",
});

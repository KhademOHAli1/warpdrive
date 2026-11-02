import { fileURLToPath } from "node:url";
import { createAgencyFixtureSource } from "./agencyPersistence.fixtureManifest";
import { createAgencyPersistenceSetup } from "./agencyPersistence.globalSetup";

// Source-owned admission only. No environment override or historical-fixture mutation.
const current0098 = createAgencyFixtureSource({
  base: fileURLToPath(
    new URL("../../../../.runtime/agency-persistence-main-base-0098-bf386af/", import.meta.url),
  ),
  expectedLastTag: "0098_workflow_duration_wait",
  journalEntries: 99,
  expectedSourceHead: "bf386af1315b066a0be402c966e7cef89bcd4f9a",
});

export default createAgencyPersistenceSetup(current0098);

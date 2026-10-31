import { classifications, classifyInventory } from "./registryClassification";
import { authenticationIds1 } from "./registryIdsAuthentication1";
import { authenticationIds2 } from "./registryIdsAuthentication2";
import { contentIds1 } from "./registryIdsContent1";
import { crmIds1 } from "./registryIdsCrm1";
import { crmIds2 } from "./registryIdsCrm2";
import { crmIds3 } from "./registryIdsCrm3";
import { emailIds1 } from "./registryIdsEmail1";
import { emailIds2 } from "./registryIdsEmail2";
import { enrichmentIds1 } from "./registryIdsEnrichment1";
import { filesIds1 } from "./registryIdsFiles1";
import { importsIds1 } from "./registryIdsImports1";
import { infrastructureIds1 } from "./registryIdsInfrastructure1";
import { infrastructureIds2 } from "./registryIdsInfrastructure2";
import { notificationsIds1 } from "./registryIdsNotifications1";
import { observabilityIds1 } from "./registryIdsObservability1";
import { privacyIds1 } from "./registryIdsPrivacy1";
import { toolingIds1 } from "./registryIdsTooling1";
import type { RegistryEntry } from "./registryTypes";

export const registryEntries: RegistryEntry[] = [
  classifyInventory([...authenticationIds1, ...authenticationIds2], classifications.authentication),
  classifyInventory([...contentIds1], classifications.content),
  classifyInventory([...crmIds1, ...crmIds2, ...crmIds3], classifications.crm),
  classifyInventory([...emailIds1, ...emailIds2], classifications.email),
  classifyInventory([...enrichmentIds1], classifications.enrichment),
  classifyInventory([...filesIds1], classifications.files),
  classifyInventory([...importsIds1], classifications.imports),
  classifyInventory([...infrastructureIds1, ...infrastructureIds2], classifications.infrastructure),
  classifyInventory([...notificationsIds1], classifications.notifications),
  classifyInventory([...observabilityIds1], classifications.observability),
  classifyInventory([...privacyIds1], classifications.privacy),
  classifyInventory([...toolingIds1], classifications.tooling),
  classifyInventory(
    ["objectNamespace:object-versions", "objectNamespace:incomplete-multipart-uploads"],
    classifications.files,
  ),
  classifyInventory(
    [
      "table:pgboss-managed-schema",
      "table:drizzle-migration-metadata",
      "derived:browser-and-next-query-caches",
      "backup:postgres-volume-and-snapshots",
      "backup:object-volume-and-snapshots",
      "backup:keys-and-lifecycle-record",
      "backup:caddy-configuration-and-certificates",
    ],
    classifications.infrastructure,
  ),
  classifyInventory(
    ["log:proxy-container-host-and-ci", "external:configured-posthog"],
    classifications.observability,
  ),
  classifyInventory(
    ["external:configured-smtp-and-recipient-mailboxes", "external:google-oauth-provider"],
    classifications.authentication,
  ),
  classifyInventory(["external:apollo-rocketreach-getprospect"], classifications.enrichment),
];

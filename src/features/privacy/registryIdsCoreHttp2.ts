// Independently reviewed optional Core process configuration, public metadata and owned work.
// delete:marker and delete:settled remove in-memory Promise Set entries, not subject records.
export const coreHttpRuntimeIds2: string[] = [
  "derived:src/server/runtime/queueOwnership.ts",
  "derived:src/server/trpc/core-runtime.ts",
  "log:src/entrypoints/core-api.ts#error",
  "writer:src/server/runtime/queueOwnership.ts#delete:marker",
  "writer:src/server/trpc/core-runtime.ts#delete:settled",
  "writer:src/server/trpc/core-service.ts#query:configuration",
  "writer:src/db/coreRoleAdmission.ts#query:dynamic",
  "sourceReview:src/config/coreEnv.ts#767ddc642e2fb9aef126748060ce67611fd6fe0ae4fd0627d29a6e8aca7de484",
  "sourceReview:src/db/client.ts#c29de5acdeeccbd9a2854bceb185648faaaa950f1f5f9fb9c168f30d701a9327",
  "sourceReview:src/db/corePoolProfile.ts#46030bfc906ddf591bbaea919d877203f0e9d7c0ace56846fd9a26b9a225c686",
  "sourceReview:src/jobs/coreProducer.ts#c5b94783fa5dda8c010d870c8d4f787e923627bf9025ea298f2e68990d6b5864",
  "sourceReview:src/jobs/appInstrumentation.ts#c852970df879c3a5d0cfa382191063a45449651443fac49b2c3d657ed32018b2",
  "sourceReview:src/features/release/webIdentity.ts#b0ebdbe96ada99be4209571d736d8f9b201787de8128d78d9f3ff32ae6640a7a",
  "sourceReview:src/features/release/webVersion.ts#78f1c8610d2ee6a92225f0007868b532ec95e662c7f01241787f004356fea414",
  "sourceReview:src/app/api/runtime/web-identity/route.ts#76be9a424c01d701cb2eb7ffa50ace8fe4b88ae4945b94c1b3f611bd0477f789",
  "sourceReview:src/db/coreRoleAdmission.ts#f0a4441b9297bbafefd082d1ba6fe9a9bf7ba6d6069339e6ba11a262c35f63e2",
  "sourceReview:src/entrypoints/core-api.ts#6f156057442ec0e20bd5a0095f9f6f53df4a766f11f042414a495cb4abfd129f",
  "sourceReview:src/server/runtime/queueOwnership.ts#02400e4371fe1cb1d3f1c324a9f2198dfbaca48cb0a53cd6f086d23ff2148c9b",
  "sourceReview:src/server/trpc/core-runtime.ts#0110bcc936408f047fc852efe65ab4f6787c6870b4191f5247425f5717b202db",
  "sourceReview:src/server/trpc/core-service.ts#c3e05a3e76a83e84eb2cc93e70068e6f3097ae35cb7c7c52f9b5b1e080b5336c",
];

// Synthetic domain writes and cleanup are restricted to the supervisor-owned loopback fixture.
export const coreHttpMutationQualificationIds2: string[] = [
  "external:src/server/trpc/core-http-mutations.harness.ts#fetch",
  "sourceReview:src/server/trpc/core-http-mutations.harness.ts#dae1ec673560ce6379b22406fc0b2cd4df4ac52048df172ff9355abbac1dcead",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:auditEvents",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:deals",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:leads",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:newsletterExposureReceipts",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:newsletterPersonAddresses",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:persons",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:pipelines",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:savedFilters",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:stages",
  "writer:src/server/trpc/core-http-mutations.harness.ts#delete:users",
  "writer:src/server/trpc/core-http-mutations.harness.ts#execute:sql",
  "writer:src/server/trpc/core-http-mutations.harness.ts#insert:newsletterPersonAddresses",
  "writer:src/server/trpc/core-http-mutations.harness.ts#insert:persons",
  "writer:src/server/trpc/core-http-mutations.harness.ts#query:dynamic",
];

// Role/catalog/lock changes belong only to a generated disposable PostgreSQL fixture.
export const coreRoleQualificationIds2: string[] = [
  "log:src/db/coreRoleAdmission.harness.ts#error",
  "log:src/db/coreRoleAdmission.harness.ts#warn",
  "objectNamespace:filesystem:src/db/coreRoleAdmission.harness.ts#readFileSync:path",
  "sourceReview:src/db/coreRoleAdmission.harness.ts#aadcc06784dea90486060409427c98728ce8fd927d3ae6d59cdb002778bf3177",
  "writer:src/db/coreRoleAdmission.harness.ts#query:BEGIN",
  "writer:src/db/coreRoleAdmission.harness.ts#query:GRANT harmless TO smoke_runtime WITH INHERIT FALSE, SET TRUE",
  "writer:src/db/coreRoleAdmission.harness.ts#query:LOCK TABLE pg_catalog.pg_shdepend IN ACCESS EXCLUSIVE MODE",
  "writer:src/db/coreRoleAdmission.harness.ts#query:RESET ROLE",
  "writer:src/db/coreRoleAdmission.harness.ts#query:REVOKE harmless FROM smoke_runtime",
  "writer:src/db/coreRoleAdmission.harness.ts#query:ROLLBACK",
  "writer:src/db/coreRoleAdmission.harness.ts#query:SET ROLE harmless",
  "writer:src/db/coreRoleAdmission.harness.ts#query:config",
  "writer:src/db/coreRoleAdmission.harness.ts#query:dynamic",
  "writer:src/db/coreRoleAdmission.harness.ts#query:statement",
];

// Full entrypoint qualification is confined to the supplied owned scratch/loopback fixture.
// delete:response removes a ServerResponse from a transient Set; listed SELECTs do not mutate.
export const coreHttpServiceQualificationIds2: string[] = [
  "derived:src/server/trpc/core-service.harness.ts",
  "external:src/server/trpc/core-service.harness.ts#fetch",
  "log:src/server/trpc/core-service.harness.ts#error",
  "log:src/server/trpc/core-service.harness.ts#warn",
  "objectNamespace:filesystem:src/server/trpc/core-service.harness.ts#readFileSync:path",
  "objectNamespace:filesystem:src/server/trpc/core-service.harness.ts#writeFileSync:dynamic",
  "sourceReview:src/server/trpc/core-service.harness.ts#f7e3ad041e517349e87cb670de2548818c0150bc46a1b5c123025326d6929418",
  "writer:src/server/trpc/core-service.harness.ts#delete:response",
  "writer:src/server/trpc/core-service.harness.ts#insert:dynamic",
  "writer:src/server/trpc/core-service.harness.ts#query:CREATE ROLE smoke_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public,pgboss TO smoke_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,pgboss TO smoke_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO smoke_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public,pgboss TO smoke_runtime;",
  "writer:src/server/trpc/core-service.harness.ts#query:SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('warpdrive-core-api','warpdrive-core-producer')",
  "writer:src/server/trpc/core-service.harness.ts#query:SELECT count(*)::integer AS count FROM pgboss.instance WHERE application_name='warpdrive-core-producer'",
  "writer:src/server/trpc/core-service.harness.ts#query:SELECT workers,supervise,schedule,migrate,pool_max,heartbeat_on,config FROM pgboss.instance WHERE application_name='warpdrive-core-producer' AND stopped_on IS NULL",
  "writer:src/server/trpc/core-service.harness.ts#query:SELECT current_setting('warpdrive.fixture_nonce',true) AS nonce,current_database() AS name,current_user AS role",
  "writer:src/server/trpc/core-service.harness.ts#query:dynamic",
  "writer:src/server/trpc/core-service.harness.ts#query:none",
  "writer:src/server/trpc/core-service.harness.ts#writeFileSync:dynamic",
];

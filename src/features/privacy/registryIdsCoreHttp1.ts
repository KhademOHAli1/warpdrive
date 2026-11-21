// Reviewed request-context boundaries and a separately classified disposable native fixture.
export const coreHttpIds1: string[] = [
  "derived:src/server/trpc/http.ts",
  "derived:src/server/trpc/request-csrf.ts",
  "sourceReview:src/server/trpc/context-core.ts#8ffca47f64efd973db5416a9ceac2ccc8af4f89729ec044274c5146ed1a24a84",
  "sourceReview:src/server/trpc/context.ts#1cc69812b80abe0c0f6db93d9e4a4cc7f92486299d6a420a49762544f0f5bbcc",
  "sourceReview:src/server/trpc/http.ts#6091ef738dc93e410df26c432a4b3ef7e6b5e07f8d97f17494d63352da1deb61",
  "sourceReview:src/server/trpc/request-csrf.ts#9a113a43d3b4b217199da964c5aaa08a1a4fc4a4b642d6db1883b7a5bb2901ac",
];

// These writers are admitted only on the caller-owned disposable loopback fixture database.
// delete:name is CookieJar Map bookkeeping; execute:sql is a SELECT of current_database().
export const coreHttpQualificationIds1: string[] = [
  "derived:src/server/trpc/core-http.harness.ts",
  "external:src/server/trpc/core-http.harness.ts#fetch",
  "sourceReview:src/server/trpc/core-http.harness.ts#497b9e23df0116f56f87e8e12ac96ba6e6a32bb71009d6552e9b4c3f4fb01a68",
  "writer:src/server/trpc/core-http.harness.ts#delete:authAccounts",
  "writer:src/server/trpc/core-http.harness.ts#delete:authMailOutbox",
  "writer:src/server/trpc/core-http.harness.ts#delete:authSecurityEvents",
  "writer:src/server/trpc/core-http.harness.ts#delete:authTwoFactors",
  "writer:src/server/trpc/core-http.harness.ts#delete:authUsers",
  "writer:src/server/trpc/core-http.harness.ts#delete:authVerifications",
  "writer:src/server/trpc/core-http.harness.ts#delete:name",
  "writer:src/server/trpc/core-http.harness.ts#delete:permissionSets",
  "writer:src/server/trpc/core-http.harness.ts#delete:persons",
  "writer:src/server/trpc/core-http.harness.ts#delete:sessions",
  "writer:src/server/trpc/core-http.harness.ts#delete:users",
  "writer:src/server/trpc/core-http.harness.ts#execute:sql",
  "writer:src/server/trpc/core-http.harness.ts#insert:authAccounts",
  "writer:src/server/trpc/core-http.harness.ts#insert:authUsers",
  "writer:src/server/trpc/core-http.harness.ts#insert:permissionSets",
  "writer:src/server/trpc/core-http.harness.ts#insert:persons",
  "writer:src/server/trpc/core-http.harness.ts#insert:users",
  "writer:src/server/trpc/core-http.harness.ts#query:dynamic",
  "writer:src/server/trpc/core-http.harness.ts#query:none",
  "writer:src/server/trpc/core-http.harness.ts#update:sessions",
  "writer:src/server/trpc/core-http.harness.ts#update:users",
];

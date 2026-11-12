// Reviewed request-context boundaries and a separately classified disposable native fixture.
export const coreHttpIds1: string[] = [
  "derived:src/server/trpc/http.ts",
  "derived:src/server/trpc/request-csrf.ts",
  "sourceReview:src/server/trpc/context-core.ts#13d8b7af34ce0935493d45abc444970c4a60fcfa2c33b014555a91eb3c04210b",
  "sourceReview:src/server/trpc/context.ts#22faaad47768c509a085efc815c0e8aafe11ebb663a3053fc28e9277afc4885f",
  "sourceReview:src/server/trpc/http.ts#906474961077990cd3fee779863ce96d5c377a4b8b8dd64186812e9572b56bb4",
  "sourceReview:src/server/trpc/request-csrf.ts#9a113a43d3b4b217199da964c5aaa08a1a4fc4a4b642d6db1883b7a5bb2901ac",
];

// These writers are admitted only on the caller-owned disposable loopback fixture database.
// delete:name is CookieJar Map bookkeeping; execute:sql is a SELECT of current_database().
export const coreHttpQualificationIds1: string[] = [
  "derived:src/server/trpc/core-http.harness.ts",
  "external:src/server/trpc/core-http.harness.ts#fetch",
  "sourceReview:src/server/trpc/core-http.harness.ts#928976baf683050a17648e5325b0f6effc4a1eb6b61e1f8d6ef7e208e1bc5e5d",
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

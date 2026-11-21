// Public backend HTTP routes. Exact matches precede parameter/catchall routes.

import * as route12 from "@/app/.well-known/oauth-authorization-server/route.backend";
import * as route13 from "@/app/.well-known/oauth-protected-resource/route.backend";
import * as route21 from "@/app/(app)/dashboard/export/route.backend";
import * as route23 from "@/app/(app)/leads/export/route.backend";
import * as route6 from "@/app/(app)/settings/import/[batchId]/errors.csv/route.backend";
import * as route25 from "@/app/api/auth/[...all]/route.backend";
import * as route22 from "@/app/api/auth-management/route.backend";
import * as route10 from "@/app/api/auth-management/user/route.backend";
import * as route17 from "@/app/api/auth-workflows/[...path]/route.backend";
import * as route20 from "@/app/api/billing/[[...path]]/route.backend";
import * as route3 from "@/app/api/billing/stripe/webhook/route.backend";
import * as route0 from "@/app/api/calendar/google/oauth/callback/route.backend";
import * as route1 from "@/app/api/calendar/google/oauth/start/route.backend";
import * as route19 from "@/app/api/company-billing-copy/route.backend";
import * as route24 from "@/app/api/company-lookup/route.backend";
import * as route14 from "@/app/api/company-profile/[[...path]]/route.backend";
import * as route7 from "@/app/api/email/attachments/[attachmentId]/route.backend";
import * as route8 from "@/app/api/email/delivery-reports/route.backend";
import * as route11 from "@/app/api/email/private-intake/route.backend";
import * as route4 from "@/app/api/gmail/oauth/callback/route.backend";
import * as route2 from "@/app/api/integrations/slack/callback/route.backend";
import * as manufacturingReleaseFile from "@/app/api/inventory/releases/[releaseId]/files/[artifactId]/route.backend";
import * as route15 from "@/app/api/mail-connections/[...path]/route.backend";
import * as route35 from "@/app/api/mcp/route.backend";
import * as projectCover from "@/app/api/projects/[projectId]/cover/[version]/route.backend";
import * as route9 from "@/app/api/users/[userId]/avatar/route.backend";
import * as projectIntegrator from "@/app/api/v1/workspaces/[workspaceSlug]/[...path]/route.backend";
import * as route18 from "@/app/api/work-profile/[[...path]]/route.backend";
import * as route5 from "@/app/api/workflows/[workflowId]/webhook/[versionId]/route.backend";
import * as route16 from "@/app/api/workflows-v2/[workflowId]/route.backend";
import * as route31 from "@/app/auth/callback/route.backend";
import * as route28 from "@/app/auth/dev-login/route.backend";
import * as route32 from "@/app/auth/logout/route.backend";
import * as route34 from "@/app/auth/start/route.backend";
import * as route26 from "@/app/oauth/authorize/route.backend";
import * as route29 from "@/app/oauth/register/route.backend";
import * as route33 from "@/app/oauth/token/route.backend";
import * as route27 from "@/app/t/click/[token]/route.backend";
import * as route30 from "@/app/t/open/[token]/route.backend";

export const httpRoutes = [
  {
    pattern: /^\/api\/inventory\/releases\/([^/]+)\/files\/([^/]+)\/?$/,
    params: [{ name: "releaseId" }, { name: "artifactId" }],
    handlers: manufacturingReleaseFile,
  },
  { pattern: /^\/api\/calendar\/google\/oauth\/callback\/?$/, params: [], handlers: route0 },
  { pattern: /^\/api\/calendar\/google\/oauth\/start\/?$/, params: [], handlers: route1 },
  { pattern: /^\/api\/integrations\/slack\/callback\/?$/, params: [], handlers: route2 },
  { pattern: /^\/api\/billing\/stripe\/webhook\/?$/, params: [], handlers: route3 },
  { pattern: /^\/api\/gmail\/oauth\/callback\/?$/, params: [], handlers: route4 },
  {
    pattern: /^\/api\/workflows\/([^/]+)\/webhook\/([^/]+)\/?$/,
    params: [{ name: "workflowId" }, { name: "versionId" }],
    handlers: route5,
  },
  {
    pattern: /^\/settings\/import\/([^/]+)\/errors\.csv\/?$/,
    params: [{ name: "batchId" }],
    handlers: route6,
  },
  {
    pattern: /^\/api\/email\/attachments\/([^/]+)\/?$/,
    params: [{ name: "attachmentId" }],
    handlers: route7,
  },
  { pattern: /^\/api\/email\/delivery-reports\/?$/, params: [], handlers: route8 },
  { pattern: /^\/api\/users\/([^/]+)\/avatar\/?$/, params: [{ name: "userId" }], handlers: route9 },
  { pattern: /^\/api\/auth-management\/user\/?$/, params: [], handlers: route10 },
  { pattern: /^\/api\/email\/private-intake\/?$/, params: [], handlers: route11 },
  { pattern: /^\/\.well-known\/oauth-authorization-server\/?$/, params: [], handlers: route12 },
  { pattern: /^\/\.well-known\/oauth-protected-resource\/?$/, params: [], handlers: route13 },
  {
    pattern: /^\/api\/company-profile(?:\/(.*))?\/?$/,
    params: [{ name: "path", many: true, optional: true }],
    handlers: route14,
  },
  {
    pattern: /^\/api\/mail-connections\/(.+)\/?$/,
    params: [{ name: "path", many: true }],
    handlers: route15,
  },
  {
    pattern: /^\/api\/workflows-v2\/([^/]+)\/?$/,
    params: [{ name: "workflowId" }],
    handlers: route16,
  },
  {
    pattern: /^\/api\/auth-workflows\/(.+)\/?$/,
    params: [{ name: "path", many: true }],
    handlers: route17,
  },
  {
    pattern: /^\/api\/work-profile(?:\/(.*))?\/?$/,
    params: [{ name: "path", many: true, optional: true }],
    handlers: route18,
  },
  { pattern: /^\/api\/company-billing-copy\/?$/, params: [], handlers: route19 },
  {
    pattern: /^\/api\/billing(?:\/(.*))?\/?$/,
    params: [{ name: "path", many: true, optional: true }],
    handlers: route20,
  },
  { pattern: /^\/dashboard\/export\/?$/, params: [], handlers: route21 },
  { pattern: /^\/api\/auth-management\/?$/, params: [], handlers: route22 },
  { pattern: /^\/leads\/export\/?$/, params: [], handlers: route23 },
  { pattern: /^\/api\/company-lookup\/?$/, params: [], handlers: route24 },
  { pattern: /^\/api\/auth\/(.+)\/?$/, params: [{ name: "all", many: true }], handlers: route25 },
  { pattern: /^\/oauth\/authorize\/?$/, params: [], handlers: route26 },
  { pattern: /^\/t\/click\/([^/]+)\/?$/, params: [{ name: "token" }], handlers: route27 },
  { pattern: /^\/auth\/dev-login\/?$/, params: [], handlers: route28 },
  { pattern: /^\/oauth\/register\/?$/, params: [], handlers: route29 },
  { pattern: /^\/t\/open\/([^/]+)\/?$/, params: [{ name: "token" }], handlers: route30 },
  { pattern: /^\/auth\/callback\/?$/, params: [], handlers: route31 },
  { pattern: /^\/auth\/logout\/?$/, params: [], handlers: route32 },
  { pattern: /^\/oauth\/token\/?$/, params: [], handlers: route33 },
  { pattern: /^\/auth\/start\/?$/, params: [], handlers: route34 },
  { pattern: /^\/api\/mcp\/?$/, params: [], handlers: route35 },
  {
    pattern: /^\/api\/projects\/([^/]+)\/cover\/([^/]+)\/?$/,
    params: [{ name: "projectId" }, { name: "version" }],
    handlers: projectCover,
  },
  {
    pattern: /^\/api\/v1\/workspaces\/([^/]+)\/(.+?)\/?$/,
    params: [{ name: "workspaceSlug" }, { name: "path", many: true }],
    handlers: projectIntegrator,
  },
];

import { calendarsRouter } from "@/features/activities/calendarRouter";
import { activitiesRouter } from "@/features/activities/router";
import { collaborationRouter } from "@/features/collaboration/router";
import { contactsRouter } from "@/features/contacts/router";
import { customFieldsRouter } from "@/features/custom-fields/router";
import { dealRouter } from "@/features/deals/dealRouter";
import { mailLabelsRouter } from "@/features/email/mailLabelsRouter";
import { emailRouter } from "@/features/email/router";
import { enrichmentRouter } from "@/features/enrichment/router";
import { filesRouter } from "@/features/files/router";
import { goalsRouter } from "@/features/goals/router";
import { importRouter } from "@/features/import/router";
import { inventoryRouter } from "@/features/inventory/router";
import { labelsRouter } from "@/features/labels/router";
import { leadRouter } from "@/features/leads/leadRouter";
import { locationsRouter } from "@/features/locations/router";
import { newsletterRouter } from "@/features/newsletter/router";
import { notificationsRouter } from "@/features/notifications/router";
import { oauthRouter } from "@/features/oauth/router";
import { operationsRouter } from "@/features/operations/router";
import { pipelineRouter } from "@/features/pipelines/pipelineRouter";
import { projectDocumentsRouter } from "@/features/projects/documents/router";
import { internalProjectsRouter } from "@/features/projects/router";
import { versionRouter } from "@/features/release/router";
import { savedFiltersRouter } from "@/features/saved-filters/router";
import { searchRouter } from "@/features/search/router";
import { statsRouter } from "@/features/stats/router";
import { workflowsRouter } from "@/features/workflows/router";
import { workflowsV2Router } from "@/features/workflows/v2/router";
import { commandsRouter } from "@/server/actions/router";
import { frontendRouter } from "@/server/frontend/router";
import { identityRouter } from "./routers/identity";
import { realtimeRouter } from "./routers/realtime";
import { router } from "./trpc";

export const appRouter = router({
  commands: commandsRouter,
  frontend: frontendRouter,
  identity: identityRouter,
  realtime: realtimeRouter,
  pipeline: pipelineRouter,
  deal: dealRouter,
  contacts: contactsRouter,
  customFields: customFieldsRouter,
  collaboration: collaborationRouter,
  activities: activitiesRouter,
  calendars: calendarsRouter,
  import: importRouter,
  labels: labelsRouter,
  mailLabels: mailLabelsRouter,
  lead: leadRouter,
  email: emailRouter,
  enrichment: enrichmentRouter,
  files: filesRouter,
  goals: goalsRouter,
  newsletter: newsletterRouter,
  notifications: notificationsRouter,
  oauth: oauthRouter,
  operations: operationsRouter,
  internalProjects: internalProjectsRouter,
  inventory: inventoryRouter,
  locations: locationsRouter,
  projectDocuments: projectDocumentsRouter,
  savedFilters: savedFiltersRouter,
  search: searchRouter,
  stats: statsRouter,
  workflows: workflowsRouter,
  workflowsV2: workflowsV2Router,
  version: versionRouter,
});

export type AppRouter = typeof appRouter;

// Server-side caller factory: pass a fully-formed AppContext to call procedures
// without going through the HTTP layer. Used by server components for SSR prefetch.
export const createCaller = appRouter.createCaller;

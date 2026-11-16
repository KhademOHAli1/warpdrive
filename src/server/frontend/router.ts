import { TRPCError } from "@trpc/server";
import { asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { activityTypes, teams } from "@/db/schema";
import { goals } from "@/db/schema/goals";
import { listTypes } from "@/features/activities/typesRepo";
import { projectLanding } from "@/features/agency-projects/nativeViews";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { CSRF_COOKIE } from "@/features/auth/csrf";
import { parseBillingConfig } from "@/features/billing/config";
import { getCompanyMemberProjection } from "@/features/company-profile/repository";
import { toContactActor } from "@/features/contacts/actorAdapters";
import { getContactFollowers } from "@/features/contacts/followers";
import { listOrgOptions } from "@/features/contacts/orgOptionsRepo";
import { getOrg } from "@/features/contacts/orgsRepo";
import { listPersonMatchCandidates } from "@/features/contacts/personOptionsRepo";
import { getPerson } from "@/features/contacts/personsRepo";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { listHiddenBuiltins } from "@/features/custom-fields/hiddenBuiltinsRepo";
import {
  resolveCustomFieldRefLabels,
  resolveCustomFieldRefLabelsFor,
} from "@/features/custom-fields/refLabels";
import { getWorkspace } from "@/features/deal-workspace/summaryRepo";
import { listSignatures, listTemplatesForSettings } from "@/features/email/emailAuthoringReads";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import { getActorGmailMailboxStatus, getActorMailbox } from "@/features/email/mailboxOwnership";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { listTeamMembers } from "@/features/identity/teams.service";
import { listAssignableUsers } from "@/features/identity/users.service";
import { listGroupMembers } from "@/features/identity/visibility-groups.service";
import { listServiceConnections } from "@/features/integrations/service";
import { slackConfiguration } from "@/features/integrations/slack";
import { listLabels } from "@/features/labels/labelsRepo";
import { getLeadById, getLeadRelations } from "@/features/leads/leadRepo";
import { newsletterConfigured } from "@/features/newsletter/listmonkClient";
import { authorizationRequestInput, authorizationSearchParams } from "@/features/oauth/authorize";
import { getClient } from "@/features/oauth/clients";
import { can } from "@/features/permissions/can";
import { listLifecyclePipelines } from "@/features/pipelines/pipelineLifecycle";
import { listLostReasons } from "@/features/settings/lostReasonsRepo";
import { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import { loadDashboardConfig } from "@/features/stats/stageNames";
import { visiblePipelineOptions } from "@/features/stats/visiblePipelines";
import { readWorkNavigation } from "@/features/work-profile/navigation";
import { getWorkflow } from "@/features/workflows/queries";
import { readWorkflowV2 } from "@/features/workflows/v2/persistence";
import { resolveWorkflowEngine } from "@/features/workflows/v2/queries";
import { readWorkflowRuntime } from "@/features/workflows/v2/runtime";
import type { HydratedActor } from "@/server/hydrateActor";
import { backendRequest } from "@/server/request";
import { protectedProcedure, publicProcedure, router } from "@/server/trpc/trpc";

function requireManage(actor: HydratedActor): void {
  if (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))
    throw new TRPCError({ code: "FORBIDDEN" });
}

const recordId = z.object({ id: z.string().uuid() });

export const frontendRouter = router({
  configuration: publicProcedure.query(() => {
    return {
      BASE_URL: env.BASE_URL,
      MCP_ENABLED: env.MCP_ENABLED,
      SALES_NEXT_ACTION_QUEUE_ENABLED: env.SALES_NEXT_ACTION_QUEUE_ENABLED,
      SALES_PIPELINE_LIFECYCLE_ENABLED: env.SALES_PIPELINE_LIFECYCLE_ENABLED,
      GMAIL_CONFIGURED: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
      BILLING_ENABLED: env.BILLING_ENABLED,
      POSTHOG_KEY: env.POSTHOG_KEY,
      POSTHOG_HOST: env.POSTHOG_HOST,
      APP_VERSION: env.APP_VERSION,
      APP_COMMIT: env.APP_COMMIT,
      DISABLE_TELEMETRY: env.DISABLE_TELEMETRY,
      TELEMETRY_CONSOLE_FORWARDING: env.TELEMETRY_CONSOLE_FORWARDING,
    };
  }),
  billingConfiguration: protectedProcedure.query(({ ctx }) => {
    if (ctx.actor.type !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const billing = parseBillingConfig(env, env.BASE_URL);
    return billing === null
      ? null
      : {
          includedSeats: billing.includedSeats,
          allowedCountries: [...billing.allowedCountries],
        };
  }),
  bootstrap: publicProcedure.query(async ({ ctx }) => {
    const actor = ctx.actor;
    const request = backendRequest()?.request;
    const pending =
      ctx.actor === null && request !== undefined
        ? await resolveWorkflowSession(ctx.db, request.headers, AbortSignal.timeout(5_000), {
            allowPending: true,
          })
        : null;
    const shell =
      actor === null
        ? null
        : await (async () => {
            const [prefs, baseCurrency, brand, navigation, projects] = await Promise.all([
              getPreferencesForActor(ctx.db, actor.id),
              readBaseCurrency(ctx.db, AbortSignal.timeout(5_000)),
              getCompanyMemberProjection(ctx.db, AbortSignal.timeout(5_000)),
              readWorkNavigation(ctx.db, actor, AbortSignal.timeout(5_000)),
              ctx.session === null
                ? null
                : projectLanding(ctx.db, ctx.session, AbortSignal.timeout(5_000)),
            ]);
            return {
              prefs,
              baseCurrency,
              brand,
              navigation,
              projects,
              newsletterConfigured: newsletterConfigured(),
            };
          })();
    return {
      actor: ctx.actor,
      session: ctx.session === null ? null : { userId: ctx.session.userId },
      localeFallback: ctx.localeFallback,
      pendingAuthentication: pending !== null,
      shell,
    };
  }),
  preferences: protectedProcedure.query(({ ctx }) => getPreferencesForActor(ctx.db, ctx.actor.id)),
  oauthConsent: publicProcedure
    .input(z.record(z.string(), z.union([z.string(), z.array(z.string()), z.undefined()])))
    .query(async ({ ctx, input }) => {
      if (!env.MCP_ENABLED) return { kind: "notfound" as const };
      const parsed = authorizationRequestInput.safeParse(input);
      if (!parsed.success) return { kind: "notfound" as const };
      const client = await getClient(ctx.db, parsed.data.client_id, AbortSignal.timeout(5_000));
      if (client?.redirectUris.includes(parsed.data.redirect_uri) !== true)
        return { kind: "notfound" as const };
      const csrfToken = backendRequest()?.cookies.get(CSRF_COOKIE)?.value;
      const action = new URL("/oauth/authorize", env.BASE_URL);
      action.search = authorizationSearchParams(parsed.data).toString();
      if (ctx.session === null || csrfToken === undefined)
        return { kind: "redirect" as const, url: `${action.pathname}${action.search}` };
      action.searchParams.set("csrf_token", csrfToken);
      return {
        kind: "ready" as const,
        action: `${action.pathname}${action.search}`,
        clientName: client.name,
        redirectUri: parsed.data.redirect_uri,
      };
    }),
  baseCurrency: protectedProcedure.query(({ ctx }) =>
    readBaseCurrency(ctx.db, AbortSignal.timeout(5_000)),
  ),
  dashboardConfiguration: protectedProcedure.query(({ ctx }) =>
    loadDashboardConfig(ctx.db, AbortSignal.timeout(5_000)),
  ),
  projectsLanding: protectedProcedure.query(({ ctx }) =>
    projectLanding(ctx.db, ctx.session, AbortSignal.timeout(10_000)),
  ),
  mailbox: protectedProcedure.query(({ ctx }) =>
    getActorMailbox(ctx.db, ctx.actor.id, AbortSignal.timeout(8_000)),
  ),
  mailboxes: protectedProcedure.query(({ ctx }) =>
    listActorMailboxes(ctx.db, ctx.actor.id, AbortSignal.timeout(5_000)),
  ),
  emailSettings: protectedProcedure.query(async ({ ctx }) => {
    const signal = AbortSignal.timeout(15_000);
    const [templates, signatures] = await Promise.all([
      listTemplatesForSettings(ctx.db, { actor: ctx.actor }, signal),
      listSignatures(ctx.db, { actor: ctx.actor }, signal),
    ]);
    return { templates, signatures };
  }),
  connections: protectedProcedure.query(async ({ ctx }) => {
    const [services, mailbox] = await Promise.all([
      listServiceConnections(ctx.db),
      getActorGmailMailboxStatus(ctx.db, ctx.actor.id, AbortSignal.timeout(5_000)),
    ]);
    return { services, mailbox, slackConfigured: slackConfiguration() !== null };
  }),
  teamMembers: protectedProcedure.input(recordId).query(({ ctx, input }) => {
    requireManage(ctx.actor);
    return listTeamMembers(ctx.db, input.id, AbortSignal.timeout(5_000));
  }),
  groupMembers: protectedProcedure
    .input(recordId)
    .query(({ ctx, input }) =>
      listGroupMembers(ctx.db, ctx.actor, input.id, AbortSignal.timeout(5_000)),
    ),
  hiddenBuiltins: protectedProcedure.query(({ ctx }) =>
    listHiddenBuiltins(ctx.db, AbortSignal.timeout(10_000)),
  ),
  labels: protectedProcedure.query(({ ctx }) => {
    requireManage(ctx.actor);
    return listLabels(ctx.db, {}, AbortSignal.timeout(5_000));
  }),
  lostReasons: protectedProcedure.query(({ ctx }) => {
    requireManage(ctx.actor);
    return listLostReasons(ctx.db, AbortSignal.timeout(5_000));
  }),
  activityTypes: protectedProcedure.query(({ ctx }) => {
    requireManage(ctx.actor);
    return listTypes(ctx.db, { activeOnly: false }, AbortSignal.timeout(5_000));
  }),
  lifecyclePipelines: protectedProcedure.query(({ ctx }) =>
    listLifecyclePipelines(ctx.db, ctx.actor.id, AbortSignal.timeout(8_000)),
  ),
  workflowRuntime: protectedProcedure.query(({ ctx }) =>
    readWorkflowRuntime(ctx.db, ctx.actor, AbortSignal.timeout(10_000)),
  ),
  workflowPage: protectedProcedure.input(recordId).query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const engine = await resolveWorkflowEngine(ctx.db, ctx.actor, input.id, signal);
    if (!engine.ok) return null;
    if (engine.value === 2) {
      const workflow = await readWorkflowV2(ctx.db, ctx.actor, input.id, signal);
      return workflow.ok ? { engine: 2 as const, value: workflow.value } : null;
    }
    const workflow = await getWorkflow(ctx.db, ctx.actor, input.id, signal);
    return workflow.ok ? { engine: 1 as const, value: workflow.value } : null;
  }),
  goalSettings: protectedProcedure.query(async ({ ctx }) => {
    if (!can(ctx.actor, "goals.manage")) throw new TRPCError({ code: "FORBIDDEN" });
    const signal = AbortSignal.timeout(5_000);
    const [goalRows, assignableUsers, teamRows, pipelineRows, typeRows, baseCurrency] =
      await Promise.all([
        ctx.db.select().from(goals).where(isNull(goals.deletedAt)).orderBy(asc(goals.startsOn)),
        listAssignableUsers(ctx.db, signal),
        ctx.db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
        visiblePipelineOptions(ctx.db, ctx.actor, signal),
        ctx.db
          .select({ id: activityTypes.id, name: activityTypes.name })
          .from(activityTypes)
          .where(isNull(activityTypes.archivedAt))
          .orderBy(asc(activityTypes.order)),
        readBaseCurrency(ctx.db, signal),
      ]);
    return { goalRows, users: assignableUsers, teamRows, pipelineRows, typeRows, baseCurrency };
  }),
  personDetail: protectedProcedure.input(recordId).query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const found = await getPerson(ctx.db, toContactActor(ctx.actor), input.id, signal);
    if (!found.ok) return null;
    const person = found.value;
    const [org, defs, baseCurrency, followers, hidden] = await Promise.all([
      person.orgId === null
        ? null
        : getOrg(ctx.db, toContactActor(ctx.actor), person.orgId, signal),
      listDefs(ctx.db, "person", {}, signal),
      readBaseCurrency(ctx.db, signal),
      getContactFollowers(ctx.db, ctx.actor, "person", person.id, signal),
      listHiddenBuiltins(ctx.db, signal),
    ]);
    const refLabels = await resolveCustomFieldRefLabels(
      ctx.db,
      ctx.actor,
      defs,
      [{ customFields: person.customFields as Record<string, unknown> }],
      signal,
    );
    return {
      person,
      orgName: org?.ok === true ? org.value.name : null,
      defs,
      baseCurrency,
      followers,
      hidden,
      refLabels,
    };
  }),
  orgDetail: protectedProcedure.input(recordId).query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const found = await getOrg(ctx.db, toContactActor(ctx.actor), input.id, signal);
    if (!found.ok) return null;
    const org = found.value;
    const [defs, baseCurrency, followers, hidden] = await Promise.all([
      listDefs(ctx.db, "organization", {}, signal),
      readBaseCurrency(ctx.db, signal),
      getContactFollowers(ctx.db, ctx.actor, "organization", org.id, signal),
      listHiddenBuiltins(ctx.db, signal),
    ]);
    const refLabels = await resolveCustomFieldRefLabels(
      ctx.db,
      ctx.actor,
      defs,
      [{ customFields: org.customFields as Record<string, unknown> }],
      signal,
    );
    return { org, defs, baseCurrency, followers, hidden, refLabels };
  }),
  leadDetail: protectedProcedure.input(recordId).query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const lead = await getLeadById(
      ctx.db,
      {
        userId: ctx.actor.id,
        isAdmin: ctx.actor.type === "admin",
        isActive: ctx.actor.isActive,
        sessionLive: true,
        visibilityGroupIds: [...ctx.actor.groupIds],
        managedUserIds: [...(ctx.actor.managedUserIds ?? [])],
      },
      input.id,
      signal,
    );
    if (lead === null) return null;
    const [
      relations,
      hidden,
      personCustomFieldDefs,
      organizationCustomFieldDefs,
      leadCustomFieldDefs,
      baseCurrency,
    ] = await Promise.all([
      getLeadRelations(ctx.db, ctx.actor, lead, signal),
      listHiddenBuiltins(ctx.db, signal),
      listDefs(ctx.db, "person", {}, signal),
      listDefs(ctx.db, "organization", {}, signal),
      listDefs(ctx.db, "lead", {}, signal),
      readBaseCurrency(ctx.db, signal),
    ]);
    const refLabels = await resolveCustomFieldRefLabelsFor(
      ctx.db,
      ctx.actor,
      [
        {
          defs: leadCustomFieldDefs,
          rows: [{ customFields: lead.customFields as Record<string, unknown> }],
        },
        {
          defs: personCustomFieldDefs,
          rows: [
            { customFields: (relations.person?.customFields ?? {}) as Record<string, unknown> },
          ],
        },
        {
          defs: organizationCustomFieldDefs,
          rows: [{ customFields: (relations.org?.customFields ?? {}) as Record<string, unknown> }],
        },
      ],
      signal,
    );
    return {
      lead,
      relations,
      hidden,
      personCustomFieldDefs,
      organizationCustomFieldDefs,
      leadCustomFieldDefs,
      baseCurrency,
      refLabels,
    };
  }),
  dealDetail: protectedProcedure.input(recordId).query(async ({ ctx, input }) => {
    const signal = AbortSignal.timeout(10_000);
    const found = await getWorkspace(ctx.db, ctx.actor, input.id, signal);
    if (!found.ok) return null;
    const workspace = found.value;
    const [
      mailbox,
      prefs,
      baseCurrency,
      assignableUsers,
      orgOptions,
      personOptions,
      hiddenBuiltins,
    ] = await Promise.all([
      getActorMailbox(ctx.db, ctx.actor.id, signal),
      getPreferencesForActor(ctx.db, ctx.actor.id),
      readBaseCurrency(ctx.db, signal),
      listAssignableUsers(ctx.db, signal),
      listOrgOptions(ctx.db, { ...ctx.actor, primaryVisibilityGroupId: null }, signal),
      workspace.person === null
        ? listPersonMatchCandidates(
            ctx.db,
            { ...ctx.actor, primaryVisibilityGroupId: null },
            signal,
          )
        : [],
      listHiddenBuiltins(ctx.db, signal),
    ]);
    const refLabels = await resolveCustomFieldRefLabelsFor(
      ctx.db,
      ctx.actor,
      [
        {
          defs: workspace.customFieldDefs,
          rows: [{ customFields: workspace.deal.customFields as Record<string, unknown> }],
        },
        {
          defs: workspace.personCustomFieldDefs,
          rows: [
            { customFields: (workspace.person?.customFields ?? {}) as Record<string, unknown> },
          ],
        },
        {
          defs: workspace.organizationCustomFieldDefs,
          rows: [{ customFields: (workspace.org?.customFields ?? {}) as Record<string, unknown> }],
        },
      ],
      signal,
    );
    return {
      workspace,
      mailbox,
      prefs,
      baseCurrency,
      assignableUsers,
      orgOptions,
      personOptions,
      hiddenBuiltins,
      refLabels,
    };
  }),
});

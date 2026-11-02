import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import type { Db } from "@/db/client";
import {
  activities,
  activityTypes,
  authAccounts,
  authUsers,
  deals,
  emailAccounts,
  integrationConnections,
  oauthClients,
  permissionSets,
  sessions,
  userPreferences,
  users,
  workflowRuns,
  workflows,
} from "@/db/schema";
import { createBetterAuth } from "@/features/auth/better/auth";
import { type LocalePreferences, localePreferencesSchema } from "@/features/i18n/preferences";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { hydrateActor } from "@/server/hydrateActor";
import { seedIntegrationFixtureRecords } from "@/test/integrationPlatformFixturesRecords";
import { canWorkflow, type WorkflowCapability } from "./access";
import { createWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const initialPreferences: LocalePreferences = {
  locale: "en",
  calendar: "gregory",
  timeZone: "Europe/Berlin",
  numberingSystem: "latn",
};

const workflowCapabilities: readonly WorkflowCapability[] = [
  "view",
  "create",
  "edit",
  "publish",
  "run",
  "cancel",
];

const memberFlags: Partial<Record<PermissionFlagKey, boolean>> = {
  "workflow.view": true,
  "workflow.create": true,
  "workflow.edit": true,
  "workflow.publish": true,
  "workflow.run": true,
  "workflow.cancel": true,
  "activity.create": true,
  "deal.create": true,
  "deal.edit_own": true,
};

export function browserDurationDefinition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Manual start", config: {} },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Wait one elapsed minute",
        config: { minutes: { kind: "value", value: 1 } },
      },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read current synthetic deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Create linked synthetic task",
        config: {
          subject: { kind: "reference", nodeId: "read", path: ["title"] },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}

async function requireEmptyBrowserDatabase(db: Db, signal: AbortSignal): Promise<void> {
  const current = await db.execute<{ name: string }>(sql.raw("SELECT current_database() AS name"));
  if (!/^t_[a-f0-9]{32}$/.test(current.rows[0]?.name ?? ""))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Task-owned disposable browser database required");
  // Admitted migration catalogs may exist; prior actor/CRM/run/provider data may not.
  const occupied = await Promise.all([
    db.select({ id: users.id }).from(users).limit(1),
    db.select({ id: authUsers.id }).from(authUsers).limit(1),
    db.select({ id: authAccounts.id }).from(authAccounts).limit(1),
    db.select({ id: sessions.id }).from(sessions).limit(1),
    db.select({ id: deals.id }).from(deals).limit(1),
    db.select({ id: activities.id }).from(activities).limit(1),
    db.select({ id: workflows.id }).from(workflows).limit(1),
    db.select({ id: workflowRuns.id }).from(workflowRuns).limit(1),
    db.select({ id: emailAccounts.id }).from(emailAccounts).limit(1),
    db.select({ id: integrationConnections.id }).from(integrationConnections).limit(1),
    db.select({ id: oauthClients.id }).from(oauthClients).limit(1),
  ]);
  signal.throwIfAborted();
  if (occupied.some((rows) => rows.length !== 0))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Browser database is not empty");
}

async function grantBrowserMember(
  db: Db,
  memberId: string,
  namespace: string,
  preferences: LocalePreferences,
  now: Date,
  signal: AbortSignal,
) {
  const [permissionSet] = await db
    .insert(permissionSets)
    .values({ name: "workflow-browser-member-" + namespace, flags: memberFlags })
    .returning({ id: permissionSets.id });
  if (permissionSet === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Browser member permissions missing");
  await db.update(users).set({ permissionSetId: permissionSet.id }).where(eq(users.id, memberId));
  await db
    .update(userPreferences)
    .set({ timezone: preferences.timeZone, ui: { localePreferences: preferences }, updatedAt: now })
    .where(eq(userPreferences.userId, memberId));
  const actor = await hydrateActor(db, memberId, signal);
  if (
    actor === null ||
    !workflowCapabilities.every((capability) => canWorkflow(actor, capability)) ||
    !can(actor, "activity.create")
  )
    throw new AppError(ERROR_IDS.WORKFLOW_DENIED, "Browser member authority unavailable");
  return actor;
}

async function requireBrowserDealAndTask(
  db: Db,
  actor: PermSetUser,
  dealId: string,
  signal: AbortSignal,
) {
  const visible = await assertReferenceVisible(
    db,
    {
      userId: actor.id,
      isActive: actor.isActive,
      sessionLive: true,
      isAdmin: false,
      visibilityGroupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    { kind: "deal", id: dealId },
    signal,
  );
  if (!visible.ok) throw new AppError(ERROR_IDS.WORKFLOW_DENIED, "Browser deal is not visible");
  const [taskType] = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)));
  signal.throwIfAborted();
  if (taskType === undefined)
    throw new AppError(ERROR_IDS.WORKFLOW_NOT_READY, "Active task catalog required");
}

export interface WorkflowBrowserLogin {
  userId: string;
  email: string;
  password: string;
}

// Provisioning, admitted migration basis, pool lifetime and disposal belong to the launcher.
export async function seedWorkflowBrowserFixture(
  db: Db,
  signal: AbortSignal,
  preferences: LocalePreferences = initialPreferences,
) {
  if (env.NODE_ENV !== "test" || !env.AUTH_ALLOW_PASSWORD)
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Test password authentication is required");
  await requireEmptyBrowserDatabase(db, signal);
  const selectedPreferences = localePreferencesSchema.parse(preferences);
  const password = "Synthetic-" + randomBytes(32).toString("base64url");
  // Existing credential protocol fixtures use this native password hasher.
  const passwordHash = await (await createBetterAuth(db).$context).password.hash(password);
  signal.throwIfAborted();
  const now = new Date();
  const namespace = randomBytes(12).toString("hex");
  return db.transaction(async (tx) => {
    const core = await seedIntegrationFixtureRecords(tx, namespace, now, signal);
    const member = core.users.member;
    await tx.insert(authUsers).values({
      id: member.id,
      email: member.email,
      name: member.name,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(authAccounts).values({
      userId: member.id,
      providerId: "credential",
      accountId: member.id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    const actor = await grantBrowserMember(
      tx,
      member.id,
      namespace,
      selectedPreferences,
      now,
      signal,
    );
    await requireBrowserDealAndTask(tx, actor, core.deals.visible.id, signal);
    const created = await createWorkflow(
      tx,
      actor,
      { name: "Synthetic one-minute workflow", definition: browserDurationDefinition() },
      signal,
    );
    if (!created.ok)
      throw new AppError(ERROR_IDS.WORKFLOW_WRITE_FAILED, "Browser draft could not be created", {
        workflowError: created.error,
      });
    signal.throwIfAborted();
    const login: WorkflowBrowserLogin = { userId: actor.id, email: member.email, password };
    return {
      actorId: actor.id,
      workflow: {
        id: created.value.id,
        name: created.value.name,
        revision: created.value.revision,
      },
      visibleDeal: { id: core.deals.visible.id, title: core.deals.visible.title },
      hiddenDealId: core.deals.hidden.id,
      restrictedDealId: core.deals.restricted.id,
      existingActivityIds: Object.values(core.activities),
      preferences: selectedPreferences,
      // Future mode600 delivery only. No cookie/session/assurance is manufactured here.
      login,
    };
  });
}

export type WorkflowBrowserFixture = Awaited<ReturnType<typeof seedWorkflowBrowserFixture>>;

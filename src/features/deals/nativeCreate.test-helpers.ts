import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { authUsers, permissionSets, sessions, settings } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createSession, loadLiveSessionByToken } from "@/features/auth/session";
import type { TestDb } from "@/test/db";
import { nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
export const creationSignal = () => AbortSignal.timeout(10_000);

// Native-domain fixture, not browser evidence: real opaque credential creation and public
// credential loader establish the server-internal reference; no caller-supplied actor snapshot.
export async function creationFixture(h: TestDb, modern = false) {
  const id = randomUUID();
  const [set] = await h.db
    .insert(permissionSets)
    .values({ name: `Native create ${id}`, flags: { "deal.create": true } })
    .returning();
  if (set === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing test permission set");
  const user = await seedUser(h.db, { permissionSetId: set.id, isAdmin: false });
  const session = await createSession(h.db, user.id, creationSignal());
  if (!session.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing test credential");
  if (modern) {
    await h.db
      .insert(authUsers)
      .values({ id: user.id, email: user.email, name: user.name, emailVerified: true });
    await h.db
      .update(sessions)
      .set({ authMethod: "password", assurance: "password" })
      .where(eq(sessions.id, session.value.sessionId));
  }
  const authenticated = await loadLiveSessionByToken(h.db, session.value.sid, creationSignal());
  if (!authenticated.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Real credential lookup failed");
  const pipeline = await seedPipelineWithStages(h.db, ["New"]);
  const stage = pipeline.stages[0];
  if (stage === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing test stage");
  await h.db
    .insert(settings)
    .values({
      id: true,
      defaultVisibilityLevels: { deal: "owner", person: "all", organization: "all" },
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: { defaultVisibilityLevels: { deal: "owner", person: "all", organization: "all" } },
    });
  const title = `Native immutable ${id}`,
    label = `Native-${id.slice(0, 8)}`;
  const input = nativeDealCreateEnvelopeV1.parse({
    protocolVersion: 1,
    expectedActorId: user.id,
    creationOperationId: randomUUID(),
    deal: {
      title,
      pipelineId: pipeline.pipeline.id,
      stageId: stage.id,
      value: "99999999999999.9999",
      labels: [label],
    },
  });
  return {
    who: authenticated.value,
    cookie: session.value.sid,
    user,
    permissionSetId: set.id,
    pipeline,
    stage,
    input,
    label,
  };
}
export type CreationFixture = Awaited<ReturnType<typeof creationFixture>>;
export async function creationEffects(h: TestDb, fixture: CreationFixture) {
  const result = await h.pool.query<{
    deals: number;
    receipts: number;
    links: number;
    labels: number;
    channel: number;
  }>(
    `
    SELECT (SELECT count(*)::int FROM deals WHERE title=$1) AS deals,
      (SELECT count(*)::int FROM deal_create_operations WHERE actor_id=$2) AS receipts,
      (SELECT count(*)::int FROM deal_labels WHERE deal_id IN(SELECT id FROM deals WHERE title=$1)) AS links,
      (SELECT count(*)::int FROM labels WHERE target='deal' AND name=$3) AS labels,
      coalesce((SELECT version::int FROM channel_versions WHERE channel=$4),0) AS channel
  `,
    [
      fixture.input.deal.title,
      fixture.user.id,
      fixture.label,
      `pipeline:${fixture.pipeline.pipeline.id}`,
    ],
  );
  return result.rows[0];
}

import { randomUUID } from "node:crypto";
import { users } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { makeTestDb } from "@/test/db";
import {
  applyAckSchema,
  type ItemDraft,
  previewSchema,
  type WorkCommand,
  type WorkType,
} from "./contracts";
import type { WorkActor } from "./policy";
import { WorkService } from "./service";
export async function workFixture() {
  const test = await makeTestDb();
  const [u] = await test.db
    .insert(users)
    .values({ name: "Admin", email: `${randomUUID()}@example.test`, isAdmin: true })
    .returning();
  if (!u) throw Error("Could not seed work administrator");
  const admin: WorkActor = {
    id: u.id,
    type: "admin",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
  const signal = () => AbortSignal.timeout(20000);
  const run = (input: WorkCommand, actor = admin) =>
    withCurrentAuthority(test.db, "read", signal(), async (db) =>
      new WorkService(db, actor, signal()).command(input),
    );
  const preview = async (
    presetId: "vehicle_repair" | "design" | "it_consulting" = "vehicle_repair",
    locale: "en" | "de" | "fa" = "en",
    revision = 0,
  ) => {
    const p = await run({
      action: "preview",
      requestId: randomUUID(),
      presetId,
      locale,
      expectedRevision: revision,
      selection: { sales: true, delivery: true, dealFields: true, activityTypes: true },
    });
    if (!p.ok) throw Error(p.error.code);
    return previewSchema.parse(p.value);
  };
  const install = async (
    presetId: "vehicle_repair" | "design" | "it_consulting" = "vehicle_repair",
    locale: "en" | "de" | "fa" = "en",
    revision = 0,
  ) => {
    const result = await run({
      action: "apply",
      requestId: randomUUID(),
      preview: await preview(presetId, locale, revision),
    });
    if (!result.ok) throw Error(result.error.code);
    return applyAckSchema.parse(result.value);
  };
  const draft = (type: WorkType): ItemDraft => {
    const [stage] = type.stages;
    if (!stage) throw Error("Fixture workflow has no stage");
    return {
      typeId: type.id,
      stageId: stage.id,
      title: "A work record",
      description: "",
      ownerId: admin.id,
      organizationId: null,
      personId: null,
      dealId: null,
      dueDate: null,
      visibility: "owner",
      visibilityGroupId: null,
      values: {},
    };
  };
  return { ...test, admin, run, signal, preview, install, draft };
}
export type WorkFixture = Awaited<ReturnType<typeof workFixture>>;

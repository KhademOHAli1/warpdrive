import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import { projectCreateInputSchema } from "../projectCreationInput";
import { type ProjectSchemaFixture, schemaCase } from "./projectPersistence.seeds";
import { createProjectRepository } from "./projectRepository";
import { repositoryFixture, success } from "./projectRepository.test-support";

function input(f: ProjectSchemaFixture) {
  return projectCreateInputSchema.parse({
    intentId: randomUUID(),
    ownerUserId: f.ownerId,
    title: " Studio Ä / استودیو ",
    dealId: null,
    personId: null,
    orgId: f.orgId,
  });
}

async function counts(f: ProjectSchemaFixture) {
  f.signal.throwIfAborted();
  const result = await f.db.pool.query<{
    projects: string;
    members: string;
    history: string;
    requests: string;
  }>(
    "SELECT (SELECT count(*) FROM agency_projects)::text AS projects,(SELECT count(*) FROM agency_project_members)::text AS members,(SELECT count(*) FROM agency_project_history)::text AS history,(SELECT count(*) FROM agency_project_requests)::text AS requests",
  );
  f.signal.throwIfAborted();
  return result.rows[0];
}

describe("private Agency create/read/start business persistence with injected admissions", () => {
  it(
    "fails closed when production bindings or the write codec are absent",
    schemaCase(async (f) => {
      const none = createProjectRepository();
      const command = input(f);
      expect(await none.create(command, f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(await none.read(randomUUID(), f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(
        await none.start(
          { projectId: randomUUID(), intentId: randomUUID(), expectedRevision: 0 },
          f.signal,
        ),
      ).toEqual({ ok: false, error: "project_unavailable" });
      const fixture = repositoryFixture(f);
      const noCodec = createProjectRepository({
        authority: fixture.bindings.authority,
        codec: null,
      });
      expect(await noCodec.create(command, f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(fixture.calls.transactions).toBe(0);
      expect(await counts(f)).toEqual({ projects: "0", members: "0", history: "0", requests: "0" });
    }),
  );

  it(
    "atomically creates a planned project, creator membership, history and private receipt",
    schemaCase(async (f) => {
      const { repository } = repositoryFixture(f);
      const command = input(f);
      const receipt = success(await repository.create(command, f.signal));
      expect(receipt).toMatchObject({ revision: 0 });
      const project = success(await repository.read(receipt.projectId, f.signal));
      expect(project).toMatchObject({
        id: receipt.projectId,
        title: command.title,
        ownerUserId: f.ownerId,
        orgId: f.orgId,
        state: "planned",
        revision: 0,
        archivedFrom: null,
      });
      expect(Object.keys(project)).not.toContain("privatePayload");
      expect(await counts(f)).toEqual({ projects: "1", members: "1", history: "1", requests: "1" });
      const member = await f.db.pool.query(
        "SELECT project_edit,assignment_coordinate FROM agency_project_members WHERE project_id=$1 AND user_id=$2",
        [receipt.projectId, f.actorId],
      );
      expect(member.rows).toEqual([{ project_edit: true, assignment_coordinate: false }]);
    }),
  );

  it(
    "does not fabricate a separate creator member when the creator owns the project",
    schemaCase(async (f) => {
      const { repository } = repositoryFixture(f);
      success(await repository.create({ ...input(f), ownerUserId: f.actorId }, f.signal));
      expect((await counts(f))?.members).toBe("0");
    }),
  );

  it(
    "replays across repository recreation and rejects a changed payload under the same intent",
    schemaCase(async (f) => {
      const command = input(f);
      const original = success(await repositoryFixture(f).repository.create(command, f.signal));
      const fresh = repositoryFixture(f);
      expect(await fresh.repository.create(command, f.signal)).toEqual({
        ok: true,
        value: original,
      });
      expect(
        await fresh.repository.create({ ...command, title: "Changed semantics" }, f.signal),
      ).toEqual({ ok: false, error: "intent_conflict" });
      expect(fresh.calls.projectAdmissions).toBe(2);
      expect(await counts(f)).toEqual({ projects: "1", members: "1", history: "1", requests: "1" });
    }),
  );

  it(
    "reauthorizes before revealing a previously committed receipt",
    schemaCase(async (f) => {
      const command = input(f);
      success(await repositoryFixture(f).repository.create(command, f.signal));
      const denied = repositoryFixture(f, { denyProject: true });
      expect(await denied.repository.create(command, f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(denied.calls.projectAdmissions).toBe(1);
    }),
  );

  it.each(["cleared", "unreadable", "disposed"] as const)(
    "never treats a %s receipt payload as a fresh create",
    (state) =>
      schemaCase(async (f) => {
        const command = input(f);
        success(await repositoryFixture(f).repository.create(command, f.signal));
        await f.db.pool.query(
          "UPDATE agency_project_requests SET payload_state=$1,private_payload=NULL WHERE actor_user_id=$2 AND intent_id=$3",
          [state, f.actorId, command.intentId],
        );
        expect(await repositoryFixture(f).repository.create(command, f.signal)).toEqual({
          ok: false,
          error: "project_unavailable",
        });
        expect((await counts(f))?.projects).toBe("1");
      })(),
  );

  it(
    "rolls back every create write when the private codec becomes unavailable",
    schemaCase(async (f) => {
      const { repository } = repositoryFixture(f, { sealUnavailable: true });
      expect(await repository.create(input(f), f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(await counts(f)).toEqual({ projects: "0", members: "0", history: "0", requests: "0" });
    }),
  );

  it(
    "refuses creation without its global flag or with an inactive selected owner",
    schemaCase(async (f) => {
      const command = input(f);
      expect(
        await repositoryFixture(f, { grantCreate: false }).repository.create(command, f.signal),
      ).toEqual({ ok: false, error: "project_unavailable" });
      await f.db.pool.query("UPDATE users SET is_active=false WHERE id=$1", [f.ownerId]);
      expect(await repositoryFixture(f).repository.create(command, f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect((await counts(f))?.projects).toBe("0");
    }),
  );

  it(
    "starts once with revision CAS, then returns its receipt and rejects a stale new intent",
    schemaCase(async (f) => {
      const { repository } = repositoryFixture(f);
      const created = success(await repository.create(input(f), f.signal));
      const command = { projectId: created.projectId, intentId: randomUUID(), expectedRevision: 0 };
      const started = success(await repository.start(command, f.signal));
      expect(started).toEqual({ projectId: created.projectId, revision: 1 });
      expect(await repository.start(command, f.signal)).toEqual({ ok: true, value: started });
      expect(await repository.start({ ...command, intentId: randomUUID() }, f.signal)).toEqual({
        ok: false,
        error: "revision_conflict",
      });
      expect(success(await repository.read(created.projectId, f.signal))).toMatchObject({
        state: "active",
        revision: 1,
      });
      expect(await counts(f)).toEqual({ projects: "1", members: "1", history: "2", requests: "2" });
    }),
  );

  it(
    "keeps native admins outside local project access without ownership or membership",
    schemaCase(async (f) => {
      const created = success(await repositoryFixture(f).repository.create(input(f), f.signal));
      const outsider = await seedUser(f.db.db, { isAdmin: true });
      const { repository } = repositoryFixture(f, { actorId: outsider.id });
      expect(await repository.read(created.projectId, f.signal)).toEqual({
        ok: false,
        error: "project_unavailable",
      });
      expect(
        await repository.start(
          { projectId: created.projectId, intentId: randomUUID(), expectedRevision: 0 },
          f.signal,
        ),
      ).toEqual({ ok: false, error: "project_unavailable" });
    }),
  );

  it(
    "recovers a real committed create after an injected lost response without duplicating it",
    schemaCase(async (f) => {
      const command = input(f);
      expect(
        await repositoryFixture(f, { unknownAfterCommit: true }).repository.create(
          command,
          f.signal,
        ),
      ).toEqual({ ok: false, error: "unknown" });
      const result = success(await repositoryFixture(f).repository.create(command, f.signal));
      expect(result.revision).toBe(0);
      expect(await counts(f)).toEqual({ projects: "1", members: "1", history: "1", requests: "1" });
    }),
  );
});

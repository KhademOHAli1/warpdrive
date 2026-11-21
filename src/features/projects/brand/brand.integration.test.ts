import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { enableNativeProjects } from "@/features/agency-projects/nativeViews";
import { addCivilDays, civilDateRange } from "@/lib/zonedDateTime";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, type Result } from "@/types/result";
import {
  createProjectIntake,
  readProjectIntake,
  reviewProjectIntake,
  setProjectIntakeEnabled,
} from "../intake/service";
import { createInternalProject, listInternalProjects, readInternalProject } from "../service";
import { projectToday } from "../settings/projectTime";
import { saveInternalProjectSettings } from "../settings/service";
import { readPrivateProjectCover } from "./cover";

let fixture: TestDb;
beforeAll(async () => {
  fixture = await makeTestDb();
});
afterAll(async () => {
  await fixture?.close();
});
const signal = () => AbortSignal.timeout(10_000);

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(`Unexpected result: ${String(result.error)}`);
  return result.value;
}

async function staff(name: string) {
  const user = await seedUser(fixture.db, { name, isAdmin: true });
  const sessionId = randomUUID();
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 300_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId: user.id, sessionId };
}

test("stores project branding, safely normalizes uploaded bytes and never serves a private cover to an outsider", async () => {
  const { db } = fixture;
  const [owner, outsider] = await Promise.all([staff("Brand owner"), staff("Brand outsider")]);
  value(await enableNativeProjects(db, owner, true, signal()));
  const title = "Creative studio";
  const { id: projectId } = value(
    await createInternalProject(db, owner, { id: randomUUID(), title }, signal()),
  );
  const target = { projectId, revision: 0, title, description: "", timeZone: "Europe/Berlin" };
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64");
  expect(
    await saveInternalProjectSettings(db, owner, { ...target, coverImage: svg }, signal()),
  ).toEqual(err("project_invalid"));
  const logo = { kind: "emoji", value: "🚀" } as const;
  const coverImage = (
    await sharp({ create: { width: 30, height: 12, channels: 3, background: "#222244" } })
      .png()
      .toBuffer()
  ).toString("base64");
  const saved = value(
    await saveInternalProjectSettings(db, owner, { ...target, logo, coverImage }, signal()),
  );
  const cover = saved.project.cover;
  if (cover?.kind !== "image") throw new Error("Missing uploaded cover");
  expect(saved.settings.timeZone).toBe("Europe/Berlin");
  expect(value(await listInternalProjects(db, owner, signal())).projects).toContainEqual(
    expect.objectContaining({ id: projectId, logo, cover, timeZone: "Europe/Berlin" }),
  );
  expect(await readPrivateProjectCover(db, outsider, projectId, cover.value, signal())).toEqual(
    err("project_unavailable"),
  );
  const bytes = value(await readPrivateProjectCover(db, owner, projectId, cover.value, signal()));
  expect(await sharp(bytes).metadata()).toMatchObject({ format: "webp", width: 30, height: 12 });
  const preset = { kind: "preset", value: "ocean" } as const;
  expect(
    value(
      await saveInternalProjectSettings(
        db,
        owner,
        { ...target, revision: 1, cover: preset },
        signal(),
      ),
    ).project.cover,
  ).toEqual(preset);
  expect(await readPrivateProjectCover(db, owner, projectId, cover.value, signal())).toEqual(
    err("project_unavailable"),
  );
});

test("keeps open Intake snoozes on their selected civil day when the project time zone changes", async () => {
  const { db } = fixture;
  const owner = await staff("Time zone owner");
  value(await enableNativeProjects(db, owner, true, signal()));
  const title = "Cross-zone project";
  const { id: projectId } = value(
    await createInternalProject(db, owner, { id: randomUUID(), title }, signal()),
  );
  const oldZone = "America/Los_Angeles";
  const newZone = "Pacific/Auckland";
  const details = { projectId, title, description: "" };
  expect(value(await readInternalProject(db, owner, projectId, signal())).settings.timeZone).toBe(
    "UTC",
  );
  value(
    await saveInternalProjectSettings(
      db,
      owner,
      { ...details, revision: 0, timeZone: oldZone },
      signal(),
    ),
  );
  value(
    await setProjectIntakeEnabled(db, owner, { projectId, revision: 1, enabled: true }, signal()),
  );
  const { id: requestId } = value(
    await createProjectIntake(
      db,
      owner,
      {
        projectId,
        intentId: randomUUID(),
        title: "Revisit on the published date",
        description: "",
        priority: "none",
      },
      signal(),
    ),
  );
  const until = addCivilDays(projectToday(oldZone), 7);
  value(
    await reviewProjectIntake(
      db,
      owner,
      { projectId, requestId, revision: 0, action: "snooze", until },
      signal(),
    ),
  );
  const selected = () =>
    readProjectIntake(db, owner, { projectId, requestId, filter: "snoozed", page: 1 }, signal());
  expect(value(await selected()).selected?.snoozedUntil).toBe(
    civilDateRange(until, until, oldZone).from.toISOString(),
  );
  value(
    await saveInternalProjectSettings(
      db,
      owner,
      { ...details, revision: 2, timeZone: newZone },
      signal(),
    ),
  );
  expect(value(await selected()).selected).toMatchObject({
    snoozedUntil: civilDateRange(until, until, newZone).from.toISOString(),
    revision: 1,
  });
  const sameInstant = new Date("2026-07-01T02:00:00.000Z");
  expect(projectToday(oldZone, sameInstant)).toBe("2026-06-30");
  expect(projectToday(newZone, sameInstant)).toBe("2026-07-01");
});

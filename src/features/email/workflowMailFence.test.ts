import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import {
  type WorkflowMailDispatch,
  workflowMailRequestDigest,
  workflowMailScope,
} from "./workflowMailFence";

const request = { to: ["a@example.invalid", "b@example.invalid"], subject: "Subject" };
const dispatch: WorkflowMailDispatch = {
  request,
  purpose: {
    version: 1,
    runId: "run",
    executionId: "execution",
    effectKey: "effect",
    actorId: "actor",
    provider: "gmail",
    generation: 7,
    requestDigest: workflowMailRequestDigest(request),
  },
};

it("makes request digests insensitive to JSONB key order and sensitive to recipient order", () => {
  expect(workflowMailRequestDigest({ subject: request.subject, to: request.to })).toBe(
    dispatch.purpose.requestDigest,
  );
  expect(workflowMailRequestDigest({ ...request, to: [...request.to].reverse() })).not.toBe(
    dispatch.purpose.requestDigest,
  );
});

it("excludes workflow rows from ordinary mail and compares an exact marker for dispatch", () => {
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(workflowMailScope(sql`s.payload`)).sql).toBe(
    "NOT (s.payload ? 'workflowPurpose')",
  );
  const match = dialect.sqlToQuery(workflowMailScope(sql`s.payload`, dispatch));
  expect(match.sql).toBe("s.payload->'workflowPurpose'=$1::jsonb");
  expect(match.params).toEqual([JSON.stringify(dispatch.purpose)]);
});

import { expect, it } from "vitest";
import { legalEntityDataSchema } from "../contracts";
import { readProposal, signProposal } from "./proposals";

const candidate = {
  lei: "12345678901234567890",
  data: legalEntityDataSchema.parse({ legalName: "Example GmbH", country: "DE" }),
  sourceUrl: "https://api.gleif.org/api/v1/lei-records/12345678901234567890",
  checkedAt: "2026-11-05T12:00:00.000Z",
};
it("authenticates immutable proposals to actor and workspace and rejects expiry/tampering", () => {
  const token = signProposal(candidate, "actor-a", "workspace-a", 1000);
  expect(readProposal(token, "actor-a", "workspace-a", 1001)).toMatchObject({
    ok: true,
    value: candidate,
  });
  expect(readProposal(token, "actor-b", "workspace-a", 1001)).toMatchObject({ ok: false });
  expect(readProposal(token, "actor-a", "workspace-b", 1001)).toMatchObject({ ok: false });
  expect(readProposal(`${token.slice(0, -3)}xxx`, "actor-a", "workspace-a", 1001)).toMatchObject({
    ok: false,
  });
  expect(readProposal(token, "actor-a", "workspace-a", 1000 + 16 * 60000)).toMatchObject({
    ok: false,
  });
});

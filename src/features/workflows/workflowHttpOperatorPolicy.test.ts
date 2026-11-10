import { expect, it, vi } from "vitest";
import { parseWorkflowHttpOperatorGrants } from "./workflowHttpOperatorPolicy";

vi.mock("@/config/env", () => ({ env: { WORKFLOW_HTTP_GRANTS: "" } }));

const workflowId = "23785582-3b1e-4c55-8cba-01ecaa4b06f7";
const entry = {
  workflowId,
  url: "https://api.example.test/v1/updates?scope=fixture",
  methods: ["POST"],
  authoredHeaders: ["X-Source"],
  operatorHeaders: { Authorization: "Bearer fixture" },
};

it("loads exact operator-owned workflow grants without accepting broad or ambiguous entries", () => {
  expect(parseWorkflowHttpOperatorGrants(JSON.stringify([entry]))).toEqual([entry]);
  for (const invalid of [
    [entry, entry],
    [{ ...entry, workflowId: "*" }],
    [{ ...entry, url: "http://api.example.test/" }],
    [{ ...entry, url: "https://private:password@api.example.test/" }],
    [{ ...entry, authoredHeaders: ["Authorization"] }],
    [{ ...entry, operatorHeaders: { "X-HTTP-Method-Override": "DELETE" } }],
    [{ ...entry, operatorHeaders: { Authorization: "line one\r\nline two" } }],
  ])
    expect(parseWorkflowHttpOperatorGrants(JSON.stringify(invalid))).toEqual([]);
  expect(parseWorkflowHttpOperatorGrants("not json")).toEqual([]);
});

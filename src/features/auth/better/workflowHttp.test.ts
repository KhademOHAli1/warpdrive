import { expect, test } from "vitest";
import { isWorkflowOrigin } from "./workflowHttp";

test("public enrollment exchange accepts only same-origin JSON posts", () => {
  const request = (origin: string, type = "application/json") =>
    new Request("https://app.example.com/api/auth-workflows/invitation", {
      method: "POST",
      headers: { origin, "content-type": type, "sec-fetch-site": "same-origin" },
      body: "{}",
    });
  expect(isWorkflowOrigin(request("https://app.example.com"))).toBe(true);
  expect(isWorkflowOrigin(request("https://evil.example.com"))).toBe(false);
  expect(isWorkflowOrigin(request("null"))).toBe(false);
  expect(isWorkflowOrigin(request("https://app.example.com", "text/plain"))).toBe(false);
});

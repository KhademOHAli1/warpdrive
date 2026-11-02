import { describe, expect, it } from "vitest";
import { resolveMcpEndpoint } from "./mcpEndpoint";

describe("resolveMcpEndpoint", () => {
  it("returns the remote MCP endpoint under the public base URL", () => {
    expect(resolveMcpEndpoint({ mcpEnabled: true, baseUrl: "https://crm.example.com/" })).toBe(
      "https://crm.example.com/api/mcp",
    );
  });

  it("returns null when the MCP server is disabled", () => {
    expect(resolveMcpEndpoint({ mcpEnabled: false, baseUrl: "https://crm.example.com" })).toBe(
      null,
    );
  });

  it.each([
    "http://crm.example.com",
    "https://crm.example.com?other=1",
    "https://crm.example.com#other",
    "https://user:secret@crm.example.com",
    "https://crm.example.com/../other",
    "https://crm.example.com/%2e%2e/other",
    "https://crm.example.com\\other",
    " https://crm.example.com",
  ])("does not expose an endpoint for invalid MCP profile %j", (baseUrl) => {
    expect(resolveMcpEndpoint({ mcpEnabled: true, baseUrl })).toBeNull();
  });
});

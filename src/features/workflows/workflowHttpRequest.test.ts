import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { assert, describe, expect, it, vi } from "vitest";
import type { EndpointResolver } from "@/features/connections/connectionEndpoint";
import { resolveRunBinding } from "./runBindings";
import type { WorkflowDefinition } from "./schemas";
import {
  invokeWorkflowHttpRequest,
  prepareWorkflowHttpRequest,
  type WorkflowHttpRequestPlan,
  type WorkflowHttpRequestPolicy,
} from "./workflowHttpRequest";
import { workflowHttpRequestConfig } from "./workflowHttpRequestContract";
import type { WorkflowHttpsTransport } from "./workflowHttpRequestTransport";

vi.mock("./runBindings", () => ({ resolveRunBinding: vi.fn() }));

const url = "https://api.example.net/v1/items?channel=workflow";
const value = (raw: string | number | boolean | null) => ({ kind: "value", value: raw });
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [], edges: [] };
const policy: WorkflowHttpRequestPolicy = {
  isWorkspaceAdmin: true,
  canRunWorkflow: true,
  grants: [
    {
      url,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      authoredHeaders: ["x-correlation"],
      operatorHeaders: { Authorization: "Bearer synthetic-operator-only" },
    },
  ],
};
const post = {
  method: "POST",
  url: value(url),
  headers: [{ name: "X-Correlation", value: value("workflow-1") }],
  body: {
    kind: "json",
    fields: [
      { name: "title", value: value("Example") },
      { name: "count", value: value(2) },
    ],
  },
  response: [
    { name: "created", type: "boolean" },
    { name: "owner", type: "text", nullable: true },
  ],
};

function prepare(config: unknown = post, currentPolicy = policy) {
  return prepareWorkflowHttpRequest({
    node: { id: "http", version: 1, config },
    outputs: {},
    definition,
    policy: currentPolicy,
  });
}

function prepared(config: unknown = post) {
  const result = prepare(config);
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

const signal = () => new AbortController().signal;
const claim = (plan: WorkflowHttpRequestPlan) => ({
  executionKey: "run-1:http:0",
  requestDigest: plan.requestDigest,
});

function fixture({
  status = 201,
  headers = { "content-type": "application/json; charset=utf-8", "set-cookie": "secret=example" },
  payload = Buffer.from(
    JSON.stringify({ created: true, owner: null, ignored: "private extra response" }),
  ),
}: {
  status?: number;
  headers?: Record<string, string>;
  payload?: Buffer;
} = {}) {
  const resolver = vi.fn<EndpointResolver>().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  const response = Object.assign(new PassThrough(), { statusCode: status, headers });
  const destroy = vi.fn();
  const end = vi.fn<(body?: string) => void>(() => {
    response.end(payload);
  });
  const transport = vi.fn<WorkflowHttpsTransport>((_options, receive) => ({
    once: vi.fn(),
    destroy,
    end(body) {
      receive(response);
      end(body);
    },
  }));
  return { resolver, transport, destroy, end };
}

describe("workflow HTTP request", () => {
  it("rejects a plain claim before DNS when no fixture transport is injected", async () => {
    const plan = prepared();
    const { resolver } = fixture();
    expect(
      await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), { resolver }),
    ).toMatchObject({
      disposition: "not-sent",
      result: { ok: false, error: { reason: "invalid_claim" } },
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    "X-HTTP-Method",
    "X-HTTP-Method-Override",
    "X-Method-Override",
    "X-Original-URL",
    "X-Rewrite-URL",
  ])("blocks routing override header %s even in operator policy", (name) => {
    const headers = [{ name, value: value("override") }];
    expect(workflowHttpRequestConfig.safeParse({ ...post, headers }).success).toBe(false);
    const grants = [{ url, methods: ["POST"] as const, operatorHeaders: { [name]: "override" } }];
    expect(prepare({ ...post, headers: [] }, { ...policy, grants })).toMatchObject({
      ok: false,
      error: { reason: "grant_denied" },
    });
  });

  it("plans without credentials and sends only once through the pinned TLS endpoint", async () => {
    const plan = prepared();
    expect(JSON.stringify(plan)).not.toContain("synthetic-operator-only");
    const deps = fixture();
    const reply = await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps);
    expect(reply).toEqual({
      disposition: "response-received",
      result: {
        ok: true,
        value: { status: 201, "result.created": true, "result.owner": null },
      },
    });
    expect(deps.resolver).toHaveBeenCalledExactlyOnceWith(
      "api.example.net",
      expect.any(AbortSignal),
    );
    expect(deps.transport).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hostname: "8.8.8.8",
        servername: "api.example.net",
        port: 443,
        agent: false,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        method: "POST",
        path: "/v1/items?channel=workflow",
      }),
      expect.any(Function),
    );
    expect(deps.transport.mock.calls[0]?.[0].headers).toEqual({
      authorization: "Bearer synthetic-operator-only",
      "x-correlation": "workflow-1",
      Host: "api.example.net",
      "Accept-Encoding": "identity",
      "User-Agent": "Warpdrive Workflow HTTPS",
      "Content-Type": "application/json",
      "Content-Length": "29",
      "Idempotency-Key": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(deps.end).toHaveBeenCalledExactlyOnceWith('{"title":"Example","count":2}');
  });

  it.each(["GET", "PUT", "PATCH", "DELETE"] as const)(
    "honors the exact reviewed %s method and typed text bytes",
    async (method) => {
      const body = method === "GET" ? undefined : { kind: "text", value: value("حساب") };
      const plan = prepared({ url: value(url), method, body });
      const deps = fixture({ status: 204, headers: {}, payload: Buffer.alloc(0) });
      expect(await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps)).toEqual({
        disposition: "response-received",
        result: { ok: true, value: { status: 204 } },
      });
      const command = deps.transport.mock.calls[0]?.[0];
      expect(command?.method).toBe(method);
      expect(deps.end).toHaveBeenCalledExactlyOnceWith(body?.value.value);
      if (method === "GET") expect(command?.headers).not.toHaveProperty("Idempotency-Key");
      else
        expect(command?.headers).toMatchObject({
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": "8",
        });
    },
  );

  it("denies missing current admin/run authority and exact grant before networking", async () => {
    expect(prepare(post, { ...policy, isWorkspaceAdmin: false })).toMatchObject({
      ok: false,
      error: { reason: "unauthorized" },
    });
    const plan = prepared();
    const deps = fixture();
    for (const current of [
      { ...policy, isWorkspaceAdmin: false },
      { ...policy, canRunWorkflow: false },
      { ...policy, grants: [] },
    ]) {
      expect(
        await invokeWorkflowHttpRequest(plan, claim(plan), current, signal(), deps),
      ).toMatchObject({
        disposition: "not-sent",
        result: { ok: false },
      });
    }
    expect(deps.resolver).not.toHaveBeenCalled();
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it.each([
    "https://another.example.net/v1/items?channel=workflow",
    "https://api.example.net/v1/elsewhere?channel=workflow",
    "https://api.example.net/v1/items?channel=other",
  ])("does not grant a different origin, path or query %s", (unapproved) => {
    expect(prepare({ ...post, url: value(unapproved) })).toMatchObject({
      ok: false,
      error: { reason: "grant_denied" },
    });
  });

  it("requires exact method and authored header permission and prevents shadowing operator credentials", () => {
    const grant = { url, methods: ["POST"] as const, authoredHeaders: ["x-correlation"] };
    expect(prepare({ ...post, method: "DELETE" }, { ...policy, grants: [grant] })).toMatchObject({
      ok: false,
      error: { reason: "grant_denied" },
    });
    expect(
      prepare({ ...post, headers: [{ name: "x-other", value: value("other") }] }),
    ).toMatchObject({ ok: false, error: { reason: "grant_denied" } });
    expect(
      prepare(post, {
        ...policy,
        grants: [{ ...grant, operatorHeaders: { "X-Correlation": "operator" } }],
      }),
    ).toMatchObject({ ok: false, error: { reason: "grant_denied" } });
  });

  it.each([
    { ...post, url: value("http://api.example.net/") },
    { ...post, url: value("https://user:token@api.example.net/") },
    { ...post, url: value(`${url}#hash`) },
    { ...post, method: "GET" },
    { ...post, headers: [{ name: "Host", value: value("private.invalid") }] },
    { ...post, headers: [{ name: "Authorization", value: value("Bearer author") }] },
    { ...post, headers: [{ name: "Cookie", value: value("session=author") }] },
    { ...post, headers: [{ name: "x-correlation", value: value("line\r\nX-Injected: 1") }] },
    {
      ...post,
      headers: [
        { name: "X-Correlation", value: value("a") },
        { name: "x-correlation", value: value("b") },
      ],
    },
  ])("rejects malformed, ambiguous, or unsafe authored request config", (unsafe) => {
    expect(workflowHttpRequestConfig.safeParse(unsafe).success).toBe(false);
    expect(prepare(unsafe)).toMatchObject({ ok: false, error: { reason: "invalid_config" } });
  });

  it("rechecks a mapped URL against the same exact grant", () => {
    const reference = { kind: "reference", nodeId: "upstream", path: ["url"] };
    vi.mocked(resolveRunBinding).mockReturnValueOnce({
      state: "value",
      value: "https://other.example.net/",
      contract: { kind: "text", nullable: false },
    });
    expect(prepare({ ...post, url: reference })).toMatchObject({
      ok: false,
      error: { reason: "grant_denied" },
    });
    expect(resolveRunBinding).toHaveBeenLastCalledWith(
      reference,
      {},
      { definition, nodeId: "http", path: ["url"] },
    );
  });

  it("rejects a stale or mismatched committed claim without DNS", async () => {
    const plan = prepared();
    const changed = prepared({ ...post, response: [] });
    const deps = fixture();
    const result = await invokeWorkflowHttpRequest(changed, claim(plan), policy, signal(), deps);
    expect(result).toMatchObject({
      disposition: "not-sent",
      result: { ok: false, error: { reason: "invalid_claim" } },
    });
    expect(deps.resolver).not.toHaveBeenCalled();
  });

  it("rejects a mixed public and metadata address DNS answer and never reaches transport", async () => {
    const plan = prepared();
    const deps = fixture();
    deps.resolver.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect(
      await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps),
    ).toMatchObject({
      disposition: "not-sent",
      result: { ok: false, error: { reason: "destination_denied" } },
    });
    expect(deps.transport).not.toHaveBeenCalled();
  });

  it("reports but never follows a redirect with an unreviewed location", async () => {
    const plan = prepared();
    const deps = fixture({ status: 307, headers: { location: "https://elsewhere.example.net/" } });
    const outcome = await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps);
    expect(outcome).toMatchObject({
      disposition: "response-received",
      result: { ok: false, error: { reason: "redirect_denied", status: 307 } },
    });
    expect(JSON.stringify(outcome)).not.toContain("elsewhere");
    expect(deps.resolver).toHaveBeenCalledTimes(1);
    expect(deps.transport).toHaveBeenCalledTimes(1);
    expect(deps.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    Buffer.from('{"created":"true","owner":null}'),
    Buffer.from('{"created":true}'),
    Buffer.from('{"created":true,"owner":"\\u0000"}'),
    Buffer.from('{"created":true,"owner":"\\uD800"}'),
  ])("rejects provider fields outside the declared scalar contract", async (payload) => {
    const plan = prepared();
    const deps = fixture({ payload });
    expect(
      await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps),
    ).toMatchObject({
      disposition: "response-received",
      result: { ok: false, error: { reason: "invalid_response" } },
    });
  });

  it("treats connection loss after dispatch as unknown and does not retry", async () => {
    const plan = prepared();
    const deps = fixture();
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    deps.transport.mockImplementation(() =>
      Object.assign(socket, {
        end() {
          socket.emit("error", new Error("provider credential and diagnostic"));
        },
      }),
    );
    const outcome = await invokeWorkflowHttpRequest(plan, claim(plan), policy, signal(), deps);
    expect(outcome).toMatchObject({
      disposition: "unknown",
      result: { ok: false, error: { reason: "unavailable" } },
    });
    expect(JSON.stringify(outcome)).not.toContain("credential");
    expect(deps.transport).toHaveBeenCalledTimes(1);
  });
});

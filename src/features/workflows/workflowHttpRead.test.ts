import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { DetailedPeerCertificate } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { EndpointResolver } from "@/features/connections/connectionEndpoint";
import { GITHUB_RELEASES_URL, RELEASE_FETCH_USER_AGENT } from "@/features/release/constants";
import { readWorkflowHttp, type WorkflowHttpReadTransport } from "./workflowHttpRead";
import {
  WORKFLOW_HTTP_READ_MAX_BYTES,
  WORKFLOW_HTTP_READ_MAX_HEADER_BYTES,
  type WorkflowHttpReadFailureReason,
  type WorkflowHttpReadProfile,
  workflowHttpReadProfileId,
} from "./workflowHttpReadContract";

const releaseApi = new URL(GITHUB_RELEASES_URL);
const repository = releaseApi.pathname.split("/").slice(2, 4).join("/");
const tag = "v1.2.3";
const releaseUrl = `https://github.com/${repository}/releases/tag/${tag}`;
const validResponse = Buffer.from(
  JSON.stringify({
    tag_name: tag,
    html_url: releaseUrl,
    body: "Synthetic release notes outside the workflow projection",
  }),
);
const jsonHeaders = { "content-type": "application/vnd.github+json; charset=utf-8" };

function publicDns() {
  return vi.fn<EndpointResolver>().mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "2606:4700::1111", family: 6 },
  ]);
}

interface FixtureResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  payload?: Buffer;
}

function responseFixture({
  status = 200,
  headers = jsonHeaders,
  payload = validResponse,
}: FixtureResponse = {}) {
  const response = Object.assign(new PassThrough(), { statusCode: status, headers });
  const destroyResponse = vi.spyOn(response, "destroy");
  const destroyRequest = vi.fn();
  const transport = vi.fn<WorkflowHttpReadTransport>((_options, receive) => ({
    once: vi.fn(),
    destroy: destroyRequest,
    end() {
      receive(response);
      response.end(payload);
    },
  }));
  return { transport, destroyRequest, destroyResponse };
}

function signal() {
  return new AbortController().signal;
}

function expectReason(
  result: Awaited<ReturnType<typeof readWorkflowHttp>>,
  reason: WorkflowHttpReadFailureReason,
) {
  expect(result).toEqual({ ok: false, error: { id: expect.any(String), reason } });
}

describe("readWorkflowHttp", () => {
  it("connects only to the pinned address, preserves the original TLS identity and projects the response", async () => {
    const resolver = publicDns();
    const { transport } = responseFixture({
      headers: {
        ...jsonHeaders,
        "content-length": String(validResponse.length),
        "set-cookie": ["private=value"],
      },
    });

    expect(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), { resolver, transport }),
    ).toEqual({
      ok: true,
      value: { latestTag: tag, releaseUrl },
    });
    expect(resolver).toHaveBeenCalledExactlyOnceWith(releaseApi.hostname, expect.any(AbortSignal));
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      {
        protocol: "https:",
        hostname: "8.8.8.8",
        family: 4,
        port: 443,
        path: releaseApi.pathname,
        method: "GET",
        agent: false,
        signal: expect.any(AbortSignal),
        maxHeaderSize: WORKFLOW_HTTP_READ_MAX_HEADER_BYTES,
        joinDuplicateHeaders: true,
        insecureHTTPParser: false,
        servername: releaseApi.hostname,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        checkServerIdentity: expect.any(Function),
        headers: {
          Host: releaseApi.hostname,
          Accept: "application/vnd.github+json",
          "Accept-Encoding": "identity",
          "User-Agent": RELEASE_FETCH_USER_AGENT,
        },
      },
      expect.any(Function),
    );
    const verify = transport.mock.calls[0]?.[0].checkServerIdentity;
    const certificate = (host: string) =>
      ({ subjectaltname: `DNS:${host}` }) as DetailedPeerCertificate;
    expect(verify?.("8.8.8.8", certificate(releaseApi.hostname))).toBeUndefined();
    expect(verify?.("spoof.invalid", certificate("spoof.invalid"))).toMatchObject({
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });

  it("rejects a forged profile before DNS or HTTPS", async () => {
    const resolver = publicDns();
    const { transport } = responseFixture();
    const profile = "https://unreviewed.invalid/path" as WorkflowHttpReadProfile;

    expect(await readWorkflowHttp(profile, signal(), { resolver, transport })).toEqual({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_INVALID, reason: "invalid_profile" },
    });
    expect(resolver).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a mixed public and private DNS result before HTTPS", async () => {
    const resolver = publicDns().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const { transport } = responseFixture();

    expect(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), { resolver, transport }),
    ).toEqual({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_DENIED, reason: "destination_denied" },
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("discards a redirect and closes both streams without following it", async () => {
    const { transport, destroyRequest, destroyResponse } = responseFixture({
      status: 302,
      headers: { location: "https://unreviewed.invalid/redirect" },
    });

    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), {
        resolver: publicDns(),
        transport,
      }),
      "unexpected_status",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(destroyRequest).toHaveBeenCalledTimes(1);
    expect(destroyResponse).toHaveBeenCalled();
  });

  it.each<[string, FixtureResponse, WorkflowHttpReadFailureReason]>([
    ["wrong media type", { headers: { "content-type": "text/html" } }, "invalid_response"],
    [
      "ambiguous media type",
      { headers: { "content-type": "application/json, text/html" } },
      "invalid_response",
    ],
    [
      "compression",
      { headers: { ...jsonHeaders, "content-encoding": "gzip" } },
      "invalid_response",
    ],
    ["invalid UTF-8", { payload: Buffer.from([0xff]) }, "invalid_response"],
    ["invalid JSON", { payload: Buffer.from("{") }, "invalid_response"],
    [
      "missing required field",
      { payload: Buffer.from(JSON.stringify({ tag_name: tag })) },
      "invalid_response",
    ],
    [
      "other repository",
      {
        payload: Buffer.from(
          JSON.stringify({
            tag_name: tag,
            html_url: `https://github.com/other/repository/releases/tag/${tag}`,
          }),
        ),
      },
      "invalid_response",
    ],
    [
      "mismatched tag",
      { payload: Buffer.from(JSON.stringify({ tag_name: "v4.5.6", html_url: releaseUrl })) },
      "invalid_response",
    ],
    [
      "declared oversize",
      { headers: { ...jsonHeaders, "content-length": String(WORKFLOW_HTTP_READ_MAX_BYTES + 1) } },
      "response_limit",
    ],
    [
      "streamed oversize",
      { payload: Buffer.alloc(WORKFLOW_HTTP_READ_MAX_BYTES + 1) },
      "response_limit",
    ],
    [
      "declared length mismatch",
      { headers: { ...jsonHeaders, "content-length": String(validResponse.length + 1) } },
      "invalid_response",
    ],
  ])("rejects %s", async (_label, fixture, reason) => {
    const { transport, destroyRequest } = responseFixture(fixture);
    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), {
        resolver: publicDns(),
        transport,
      }),
      reason,
    );
    expect(destroyRequest).toHaveBeenCalledTimes(1);
  });

  it("times out stalled DNS without opening a connection", async () => {
    const resolver = vi.fn<EndpointResolver>(() => new Promise(() => {}));
    const { transport } = responseFixture();

    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), {
        resolver,
        transport,
        timeoutMs: 25,
      }),
      "timed_out",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("times out and destroys a stalled response", async () => {
    const response = Object.assign(new PassThrough(), { statusCode: 200, headers: jsonHeaders });
    const destroyResponse = vi.spyOn(response, "destroy");
    const destroyRequest = vi.fn();
    const transport = vi.fn<WorkflowHttpReadTransport>((_options, receive) => ({
      once: vi.fn(),
      destroy: destroyRequest,
      end: () => receive(response),
    }));

    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), {
        resolver: publicDns(),
        transport,
        timeoutMs: 100,
      }),
      "timed_out",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(destroyResponse).toHaveBeenCalled();
    expect(destroyRequest).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation without retaining its reason", async () => {
    const controller = new AbortController();
    const destroy = vi.fn();
    const transport = vi.fn<WorkflowHttpReadTransport>(() => ({
      once: vi.fn(),
      destroy,
      end: () => controller.abort(new Error("Synthetic caller detail")),
    }));

    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, controller.signal, {
        resolver: publicDns(),
        transport,
      }),
      "cancelled",
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("reports connection failures without retaining upstream diagnostics", async () => {
    const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const transport = vi.fn<WorkflowHttpReadTransport>(() =>
      Object.assign(request, {
        end() {
          request.emit("error", new Error("Synthetic TLS failure detail"));
        },
      }),
    );

    expectReason(
      await readWorkflowHttp(workflowHttpReadProfileId, signal(), {
        resolver: publicDns(),
        transport,
      }),
      "unavailable",
    );
    expect(request.destroy).toHaveBeenCalledTimes(1);
  });
});

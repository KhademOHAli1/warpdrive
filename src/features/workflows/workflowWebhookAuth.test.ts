import { createHmac } from "node:crypto";
import { assert, expect, it } from "vitest";
import { err, ok } from "@/types/result";
import {
  authenticateWorkflowWebhook,
  mintWorkflowWebhookSigningKey,
  type WorkflowWebhookDelivery,
  workflowWebhookRequestKey,
} from "./workflowWebhookAuth";
import {
  parseWorkflowWebhookPayload,
  projectWorkflowWebhookLaunch,
  readWorkflowWebhookLaunch,
  workflowWebhookLimits,
  workflowWebhookTriggerConfigSchema,
} from "./workflowWebhookContract";

const publication = {
  workflowId: "52f6b244-2ea8-400a-92c9-b584c938562f",
  versionId: "52f6b244-2ea8-400a-92c9-b584c9385630",
};
const eventId = "52f6b244-2ea8-400a-92c9-b584c9385631";
const recordId = "52f6b244-2ea8-400a-92c9-b584c9385632";
const signingKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString(
  "base64url",
);
const timestamp = "1773000000";
const nowMs = 1_773_000_000_000;
const rawBody = Buffer.from(JSON.stringify({ eventId, recordId }));

const delivery: WorkflowWebhookDelivery = {
  method: "POST",
  contentType: "application/json",
  publication,
  signingKey,
  timestamp,
  nowMs,
  rawBody,
  // Independent reference vector calculated with Python's HMAC implementation.
  signature: "v1=bdb8e2a152de8d05f4fb36860bbc3606f3985c2ad6a56d5f18cf710a8e9e8613",
};

function signed(input: Partial<Omit<WorkflowWebhookDelivery, "signature">> = {}) {
  const value = { ...delivery, ...input };
  const frame = [
    "warpdrive.workflow.webhook.v1",
    value.method,
    value.publication.workflowId.toLowerCase(),
    value.publication.versionId.toLowerCase(),
    value.timestamp,
    "",
  ].join("\n");
  const digest = createHmac("sha256", Buffer.from(value.signingKey, "base64url"))
    .update(frame)
    .update(value.method === "GET" ? Buffer.from(value.rawQuery ?? "") : value.rawBody)
    .digest("hex");
  return { ...value, signature: `v1=${digest}` };
}

it("authenticates a known exact-byte delivery and returns only normalized admission data", () => {
  expect(authenticateWorkflowWebhook(delivery)).toEqual(
    ok({
      publication,
      payload: { scope: "webhook", httpMethod: "POST", eventId, recordId },
      signedAtMs: nowMs,
      replayKey: workflowWebhookRequestKey(publication.workflowId, eventId),
    }),
  );
  const alternate = Buffer.from(
    JSON.stringify({ recordId: recordId.toUpperCase(), eventId: eventId.toUpperCase() }, null, 2),
  );
  expect(parseWorkflowWebhookPayload(alternate)).toEqual(ok({ eventId, recordId }));
});

it("rejects byte changes, unrelated keys/publications and ambiguous signature headers", () => {
  const alternate = Buffer.from(JSON.stringify({ recordId, eventId }));
  const nextPublication = { ...publication, versionId: recordId };
  for (const change of [
    { rawBody: alternate },
    { signingKey: Buffer.alloc(32, 8).toString("base64url") },
    { signingKey: `${signingKey}=` },
    { publication: nextPublication },
    { signature: `${delivery.signature}, ${delivery.signature}` },
    { signature: `${delivery.signature}\n` },
    { signature: "v1=abcd" },
    { timestamp: ` ${timestamp}` },
  ]) {
    expect(authenticateWorkflowWebhook({ ...delivery, ...change })).toEqual(err("unauthorized"));
  }
});

it("requires a recent, canonical timestamp from the trusted clock", () => {
  const skew = workflowWebhookLimits.clockSkewMs;
  expect(authenticateWorkflowWebhook({ ...delivery, nowMs: nowMs + skew }).ok).toBe(true);
  expect(authenticateWorkflowWebhook({ ...delivery, nowMs: nowMs - skew }).ok).toBe(true);
  for (const clock of [nowMs + skew + 1, nowMs - skew - 1, Number.NaN, 0]) {
    expect(authenticateWorkflowWebhook({ ...delivery, nowMs: clock })).toEqual(err("unauthorized"));
  }
  const extraZero = signed({ timestamp: `0${timestamp}` });
  expect(authenticateWorkflowWebhook(extraZero)).toEqual(err("unauthorized"));
});

it("enforces the POST JSON byte budget before interpreting the payload", () => {
  for (const change of [
    { method: "GET" },
    { rawQuery: `eventId=${eventId}` },
    { contentType: "text/plain" },
    { contentType: "application/json; charset=iso-8859-1" },
    { rawBody: new Uint8Array(workflowWebhookLimits.bodyBytes + 1) },
    { rawBody: new Uint8Array() },
  ]) {
    expect(authenticateWorkflowWebhook({ ...delivery, ...change })).toEqual(err("invalid-request"));
  }
  expect(
    authenticateWorkflowWebhook({ ...delivery, contentType: "application/json; charset=UTF-8" }).ok,
  ).toBe(true);
});

it("rejects extra, duplicate, malformed, or authority-bearing authenticated payloads", () => {
  const invalid = [
    Buffer.from(JSON.stringify({ eventId, recordId, actorId: recordId, mode: "live" })),
    Buffer.from(`{"eventId":"${eventId}","eventId":"${eventId}","recordId":"${recordId}"}`),
    Buffer.from(`{"eventId":"${eventId}","eventId":"${recordId}"}`),
    Buffer.from(`{"eventId":"${eventId}","record\\u0049d":"${recordId}"}`),
    Buffer.from(JSON.stringify({ eventId: { nested: eventId }, recordId })),
    Buffer.from(JSON.stringify({ eventId, recordId: "not-an-id" })),
    Buffer.concat([rawBody, Buffer.from("\u2028")]),
    Uint8Array.from([0xff, 0xfe]),
  ];
  for (const bytes of invalid)
    expect(authenticateWorkflowWebhook(signed({ rawBody: bytes }))).toEqual(err("invalid-payload"));
  expect(
    authenticateWorkflowWebhook({
      ...delivery,
      rawBody: Buffer.from(JSON.stringify({ eventId, recordId, role: "admin" })),
    }),
  ).toEqual(err("unauthorized"));
});

it("keeps one replay identity across re-signing, rotation and republication within a workflow", () => {
  const first = authenticateWorkflowWebhook(delivery);
  assert(first.ok);
  const newKey = mintWorkflowWebhookSigningKey();
  expect(newKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(mintWorkflowWebhookSigningKey()).not.toBe(newKey);
  const repeated = authenticateWorkflowWebhook(
    signed({
      signingKey: newKey,
      timestamp: "1773000030",
      nowMs: nowMs + 30_000,
      rawBody: Buffer.from(JSON.stringify({ eventId, recordId: publication.versionId })),
    }),
  );
  assert(repeated.ok);
  expect(repeated.value.replayKey).toBe(first.value.replayKey);
  const next = authenticateWorkflowWebhook(
    signed({
      publication: { ...publication, versionId: recordId },
      signingKey: newKey,
    }),
  );
  assert(next.ok);
  expect(next.value.replayKey).toBe(first.value.replayKey);
  expect(next.value.replayKey).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
  expect(workflowWebhookRequestKey(recordId, eventId)).not.toBe(first.value.replayKey);
});

it("verifies a canonical bodyless GET using the method, query and exact publication", () => {
  const request = signed({
    method: "GET",
    contentType: null,
    rawBody: new Uint8Array(),
    rawQuery: `eventId=${eventId}`,
  });
  const authenticated = authenticateWorkflowWebhook(request);
  assert(authenticated.ok);
  expect(authenticated.value.payload).toEqual({ scope: "webhook", httpMethod: "GET", eventId });
  expect(projectWorkflowWebhookLaunch(authenticated.value.payload)).toEqual({});
  expect(authenticateWorkflowWebhook({ ...request, rawQuery: `eventId=${recordId}` })).toEqual(
    err("unauthorized"),
  );
  expect(
    authenticateWorkflowWebhook({
      ...request,
      publication: { ...publication, versionId: recordId },
    }),
  ).toEqual(err("unauthorized"));
  expect(authenticateWorkflowWebhook({ ...delivery, signature: request.signature })).toEqual(
    err("unauthorized"),
  );
  for (const change of [
    { rawQuery: `eventId=${eventId}&eventId=${eventId}` },
    { rawQuery: `eventId=${eventId}&recordId=${recordId}` },
    { rawQuery: `eventId=${eventId.toUpperCase()}` },
    { rawQuery: `event%49d=${eventId}` },
    { rawQuery: "" },
    { rawBody },
    { contentType: "application/json" },
  ]) {
    expect(authenticateWorkflowWebhook({ ...request, ...change })).toEqual(err("invalid-request"));
  }
});

it("projects only authorized Deal data from the exact pinned webhook method", () => {
  const config = { httpMethod: "POST", authentication: "HMAC_SHA256" };
  const definition = { nodes: [{ id: "start", type: "trigger.webhook", version: 1, config }] };
  const authenticated = authenticateWorkflowWebhook(delivery);
  assert(authenticated.ok);
  const launch = readWorkflowWebhookLaunch(definition, authenticated.value.payload);
  assert(launch !== null);
  expect(projectWorkflowWebhookLaunch(launch)).toEqual({ recordId });
  expect(readWorkflowWebhookLaunch(definition, { ...launch, signingKey })).toBeNull();
  expect(
    readWorkflowWebhookLaunch(definition, { scope: "webhook", httpMethod: "GET", eventId }),
  ).toBeNull();
  expect(
    readWorkflowWebhookLaunch(
      {
        nodes: [
          { ...definition.nodes[0], id: "start", type: "trigger.manual", version: 1, config: {} },
        ],
      },
      launch,
    ),
  ).toBeNull();
});

it("keeps signing keys and unsigned methods out of the workflow draft", () => {
  const config = { httpMethod: "POST", authentication: "HMAC_SHA256" };
  expect(workflowWebhookTriggerConfigSchema.safeParse(config).success).toBe(true);
  expect(
    workflowWebhookTriggerConfigSchema.safeParse({ ...config, httpMethod: "GET" }).success,
  ).toBe(true);
  for (const change of [{ httpMethod: "HEAD" }, { authentication: null }, { signingKey }]) {
    expect(workflowWebhookTriggerConfigSchema.safeParse({ ...config, ...change }).success).toBe(
      false,
    );
  }
});

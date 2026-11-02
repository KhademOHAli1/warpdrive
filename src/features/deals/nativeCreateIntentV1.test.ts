import { describe, expect, test } from "vitest";
import {
  canonicalNativeJsonV1,
  exactNativeMoneyV1,
  nativeDealCreateEnvelopeV1,
  nativeDealFingerprintBytesV1,
} from "./nativeCreateIntentV1";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  operation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const pipeline = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  stage = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function envelope(deal: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    expectedActorId: actor,
    creationOperationId: operation,
    deal: { title: " A deal ", pipelineId: pipeline, stageId: stage, ...deal },
  };
}
describe("immutable native deal creation V1", () => {
  test("golden canonical bytes freeze defaults, exact money and account/operation domain", () => {
    const parsed = nativeDealCreateEnvelopeV1.parse(envelope({ value: "0001.2" }));
    expect(nativeDealFingerprintBytesV1(parsed)).toBe(
      `{"actorId":"${actor}","deal":{"customFields":{},"expectedCloseDate":null,"labels":[],"orgId":null,"personId":null,"pipelineId":"${pipeline}","sourceChannel":null,"sourceChannelId":null,"stageId":"${stage}","title":"A deal","value":"1.2000"},"domain":"warpdrive.native.deal-create","operationId":"${operation}","protocolVersion":1}`,
    );
  });
  test("numeric and exact string small amounts normalize equally without converting large strings", () => {
    expect(exactNativeMoneyV1(1500.25)).toBe("1500.2500");
    expect(exactNativeMoneyV1("1500.2500")).toBe("1500.2500");
    expect(exactNativeMoneyV1("99999999999999.9999")).toBe("99999999999999.9999");
    expect(exactNativeMoneyV1("0.0001")).toBe("0.0001");
  });
  test.each(["1.00001", "100000000000000", -1, Infinity, NaN, 1e-7])(
    "rejects unsupported exact amount %s",
    (value) => {
      expect(() => exactNativeMoneyV1(value)).toThrow();
    },
  );
  test("omitted currency/owner/group stays omitted; equivalent explicit undefined is omitted", () => {
    const parsed = nativeDealCreateEnvelopeV1.parse(
      envelope({ currency: undefined, ownerId: undefined, visibilityGroupId: undefined }),
    );
    expect(parsed.deal).not.toHaveProperty("currency");
    expect(parsed.deal).not.toHaveProperty("ownerId");
    expect(parsed.deal).not.toHaveProperty("visibilityGroupId");
    expect(() => nativeDealFingerprintBytesV1(parsed)).not.toThrow();
  });
  test("normalizes UUID spelling and label trim/case duplicates while retaining first order", () => {
    const parsed = nativeDealCreateEnvelopeV1.parse({
      ...envelope({ labels: [" Warm ", "warm", "Hot"] }),
      expectedActorId: actor.toUpperCase(),
    });
    expect(parsed.expectedActorId).toBe(actor);
    expect(parsed.deal.labels).toEqual(["Warm", "Hot"]);
  });
  test("V1 decoding does not consult today's supported-currency catalog", () => {
    expect(nativeDealCreateEnvelopeV1.parse(envelope({ currency: " xyz " })).deal.currency).toBe(
      "XYZ",
    );
  });
  test("sorts nested object keys but preserves array order and normalizes negative zero", () => {
    expect(canonicalNativeJsonV1({ b: [2, 1], a: { z: -0, a: null } })).toBe(
      '{"a":{"a":null,"z":0},"b":[2,1]}',
    );
    expect(canonicalNativeJsonV1({ b: [1, 2], a: { z: 0, a: null } })).not.toBe(
      canonicalNativeJsonV1({ b: [2, 1], a: { z: 0, a: null } }),
    );
  });
  test("rejects cyclic, undefined and non-finite custom JSON rather than silently changing intent", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const customFields of [
      cyclic,
      { x: undefined },
      { x: NaN },
      { x: Infinity },
      { x: 1n },
      { x: Symbol("x") },
    ])
      expect(nativeDealCreateEnvelopeV1.safeParse(envelope({ customFields })).success).toBe(false);
  });
  test("rejects native protocol omissions, version changes and unknown trust fields", () => {
    for (const raw of [
      { ...envelope(), protocolVersion: 2 },
      { ...envelope(), expectedActorId: undefined },
      { ...envelope(), sessionId: actor },
      envelope({ visibilityLevel: "all" }),
    ])
      expect(nativeDealCreateEnvelopeV1.safeParse(raw).success).toBe(false);
  });
  test("actor, operation, monetary digits and requested field changes change canonical bytes", () => {
    const baseline = nativeDealCreateEnvelopeV1.parse(envelope({ value: "1.0001" }));
    const bytes = nativeDealFingerprintBytesV1(baseline);
    for (const changed of [
      { ...baseline, expectedActorId: operation },
      { ...baseline, creationOperationId: actor },
      { ...baseline, deal: { ...baseline.deal, value: "1.0002" } },
      { ...baseline, deal: { ...baseline.deal, currency: "USD" } },
    ])
      expect(nativeDealFingerprintBytesV1(changed)).not.toBe(bytes);
  });
});

import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { buildDisclosureManifest, encodeDisclosureManifest } from "./disclosureManifest";

import {
  excludedDecision,
  fixture,
  includedDecision,
  signal,
  unsupportedDecision,
} from "./disclosureManifest.testHelpers";

test("P08A: versioned manifest accounts for trusted reviewed categories and labels unavailable original MIME", () => {
  const { input, context } = fixture();
  const result = buildDisclosureManifest(input, context, signal());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({
    formatVersion: 1,
    encoding: "utf-8",
    mode: "access",
    locale: "fa",
    state: "reviewed",
    blockers: [],
  });
  expect(result.value.categories).toHaveLength(4);
  expect(JSON.stringify(result.value)).toContain("مخاطب.json");
  expect(JSON.stringify(result.value)).toContain('"original":"unavailable"');
  expect(JSON.stringify(result.value)).not.toContain("publicationReady");
  expect(new TextDecoder().decode(encodeDisclosureManifest(result.value))).toContain("مخاطب.json");
});

test("P08A: portability cannot inherit an access decision for a derived category", () => {
  const { input, context } = fixture();
  const portable = { ...context, mode: "portability" };
  expect(buildDisclosureManifest({ ...input, mode: "portability" }, portable, signal())).toEqual({
    ok: false,
    error: "portability_ineligible",
  });
  const approved = fixture({ derived: excludedDecision("not_portable") });
  const approvedPortable = { ...approved.context, mode: "portability" };
  expect(
    buildDisclosureManifest({ ...approved.input, mode: "portability" }, approvedPortable, signal())
      .ok,
  ).toBe(true);
  expect(
    buildDisclosureManifest(
      { ...approved.input, mode: "portability" },
      { ...approvedPortable, policy: { ...context.policy, portabilityDecision: "unreviewed" } },
      signal(),
    ),
  ).toEqual({ ok: false, error: "portability_ineligible" });
});

test("C03/C13: missing approval, policy, verification or stale scope cannot yield a reviewed manifest", () => {
  const { input, context } = fixture();
  for (const key of [
    "scopeVersion",
    "policyVersion",
    "policyGeneration",
    "recipientVersion",
    "verificationVersion",
  ] as const) {
    expect(
      buildDisclosureManifest(
        input,
        { ...context, binding: { ...context.binding, [key]: context.binding[key] + 1 } },
        signal(),
      ),
    ).toEqual({ ok: false, error: "stale_scope" });
  }
  expect(buildDisclosureManifest(input, { ...context, scopeApproved: false }, signal())).toEqual({
    ok: false,
    error: "scope_unapproved",
  });
  expect(buildDisclosureManifest(input, { ...context, subjectVerified: false }, signal())).toEqual({
    ok: false,
    error: "verification_required",
  });
  expect(
    buildDisclosureManifest(
      input,
      { ...context, policy: { ...context.policy, activated: false } },
      signal(),
    ),
  ).toEqual({ ok: false, error: "policy_disabled" });
});

test("P08A/C12: exact trusted category and selected-record accounting rejects omissions, unknowns and substitutions", () => {
  const { input, context } = fixture();
  expect(
    buildDisclosureManifest({ ...input, categories: input.categories.slice(1) }, context, signal()),
  ).toEqual({ ok: false, error: "category_mismatch" });
  expect(
    buildDisclosureManifest(
      { ...input, categories: [...input.categories, input.categories[0]] },
      context,
      signal(),
    ),
  ).toEqual({ ok: false, error: "category_mismatch" });
  const substitute = structuredClone(input);
  const first = substitute.categories[0];
  if (first !== undefined) {
    const files = first.files as { recordIds: string[] }[];
    files[0]?.recordIds.splice(0, 1, randomUUID());
  }
  expect(buildDisclosureManifest(substitute, context, signal())).toEqual({
    ok: false,
    error: "record_mismatch",
  });
  expect(buildDisclosureManifest({ ...input, requiredCategoryIds: [] }, context, signal())).toEqual(
    { ok: false, error: "invalid_manifest" },
  );
});

test("P08B: unsupported adapters remain explicit blockers and secret stores cannot be included", () => {
  const { input, context } = fixture({ derived: unsupportedDecision() });
  const blocked = buildDisclosureManifest(input, context, signal());
  expect(blocked.ok).toBe(true);
  if (blocked.ok)
    expect(blocked.value).toMatchObject({
      state: "blocked",
      blockers: [{ categoryId: "derived", code: "adapter_unavailable", task: "DPL-08" }],
    });
  const securityDecision = includedDecision();
  const secretContext = {
    ...context,
    expectedCategories: [
      {
        id: "security",
        sourceStore: "table:auth_accounts",
        capability: "unsupported",
        recordIds: [],
        decision: securityDecision,
      },
    ],
  };
  const secret = {
    ...input,
    categories: [
      {
        id: "security",
        sourceStore: "table:auth_accounts",
        ...securityDecision,
        files: [],
      },
    ],
  };
  expect(buildDisclosureManifest(secret, secretContext, signal())).toEqual({
    ok: false,
    error: "security_material",
  });
});

test("P08B/C10: third-party/MIME claims and unsafe or colliding archive paths fail closed", () => {
  const { input, context } = fixture();
  const mutate = (change: (category: Record<string, unknown>) => void) => {
    const candidate = structuredClone(input);
    const category = candidate.categories[0];
    if (category !== undefined) change(category);
    return buildDisclosureManifest(candidate, context, signal());
  };
  expect(
    mutate((category) => {
      category.thirdParty = "pending";
    }),
  ).toEqual({ ok: false, error: "decision_mismatch" });
  expect(
    mutate((category) => {
      category.thirdParty = "redacted";
    }),
  ).toEqual({ ok: false, error: "decision_mismatch" });
  expect(
    mutate((category) => {
      category.email = { original: "unavailable", exported: "original" };
    }),
  ).toEqual({ ok: false, error: "decision_mismatch" });
  expect(
    mutate((category) => {
      const files = category.files as { path: string }[];
      if (files[0] !== undefined) files[0].path = "../private.json";
    }),
  ).toEqual({ ok: false, error: "unsafe_archive_path" });
  expect(
    mutate((category) => {
      const files = category.files as unknown[];
      files.push(structuredClone(files[0]));
    }),
  ).toEqual({ ok: false, error: "unsafe_archive_path" });
});

test("C06/C08: aborted work and oversized metadata stop before manifest processing", () => {
  const { input, context } = fixture();
  expect(() => buildDisclosureManifest(input, context, AbortSignal.abort())).toThrow();
  expect(
    buildDisclosureManifest(
      { ...input, categories: new Array(129).fill(input.categories[0]) },
      context,
      signal(),
    ),
  ).toEqual({ ok: false, error: "manifest_limit" });
});

test("P08B: trusted adapter capability cannot be upgraded by an included category", () => {
  const { input, context } = fixture();
  const unsupported = {
    ...context,
    expectedCategories: context.expectedCategories.map((category) => ({
      ...category,
      capability: "unsupported",
    })),
  };
  expect(buildDisclosureManifest(input, unsupported, signal())).toEqual({
    ok: false,
    error: "adapter_unavailable",
  });
});

test("P08A/C03: an access scope cannot authorize portability and portability grounds cannot refuse access", () => {
  const { input, context } = fixture({ derived: excludedDecision("not_portable") });
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "review_required",
  });
  expect(
    buildDisclosureManifest(
      { ...input, mode: "portability" },
      { ...context, mode: "access" },
      signal(),
    ),
  ).toEqual({ ok: false, error: "mode_mismatch" });
});

test("C01: a safe archive path cannot substitute an unreviewed record folder", () => {
  const { input, context } = fixture();
  const category = input.categories[0];
  if (category === undefined) return;
  const files = category.files as { path: string }[];
  if (files[0] !== undefined) files[0].path = `records/${randomUUID()}/subject.json`;
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "record_mismatch",
  });
});

test("C12: duplicate trusted target IDs cannot inflate a reviewed exclusion count", () => {
  const { input, context } = fixture();
  const category = context.expectedCategories[3];
  if (category === undefined || category.recordIds[0] === undefined) return;
  category.recordIds.push(category.recordIds[0]);
  expect(buildDisclosureManifest(input, context, signal())).toEqual({
    ok: false,
    error: "invalid_context",
  });
});

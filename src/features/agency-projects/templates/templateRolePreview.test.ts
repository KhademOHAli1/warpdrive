import { describe, expect, it } from "vitest";
import { previewTemplateRoleBindings } from "./templateRolePreview";
import {
  expectedMappedBindings,
  expectedOffsets,
  expectedUnmappedRoles,
  expectedUses,
  invalid,
  invalidRoleSelections,
  malformedBindings,
  mappings,
  objectsIn,
  offset,
  otherUserId,
  personId,
  userId,
  withManifest,
} from "./templateRolePreview.test-support";

describe("typed-manifest role-binding preview", () => {
  it(
    "returns all roles in manifest order with exact preview row keys",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, []);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.value).sort()).toEqual([
        "offsetAssumptions",
        "roles",
        "templateId",
        "version",
      ]);
      expect(result.value.templateId).toBe("role_preview");
      expect(result.value.version).toBe(7);
      expect(result.value.roles).toEqual(expectedUnmappedRoles);
      for (const role of result.value.roles) {
        expect(Object.keys(role).sort()).toEqual(["binding", "roleId", "roleKind", "uses"]);
      }
    }),
  );

  it(
    "accepts a mapping for an unused declared role with empty uses",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, [
        { roleId: "unused", kind: "internal-user", userId },
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.roles.find((role) => role.roleId === "unused")).toEqual({
        roleId: "unused",
        roleKind: "internal-producer",
        binding: { kind: "internal-user", userId },
        uses: [],
      });
    }),
  );

  it(
    "previews a validated manifest with no deliverables or intents",
    withManifest(
      (manifest) => {
        const result = previewTemplateRoleBindings(manifest, mappings());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.roles).toHaveLength(5);
        expect(result.value.roles.map((role) => role.uses)).toEqual([[], [], [], [], []]);
        expect(result.value.offsetAssumptions).toEqual([]);
      },
      (manifest) => {
        manifest.deliverables = [];
        manifest.intents = [];
      },
    ),
  );

  it(
    "accepts all 32 declared roles and rejects 33 input bindings",
    withManifest(
      (manifest) => {
        const input = manifest.roles.map((role) => ({
          roleId: role.id,
          kind: "internal-user",
          userId,
        }));
        const result = previewTemplateRoleBindings(manifest, input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.roles).toHaveLength(32);
        expect(result.value.roles.map((role) => role.roleId)).toEqual(
          Array.from({ length: 32 }, (_, index) => `bound_role_${index}`),
        );
        expect(result.value.roles.map((role) => role.binding)).toEqual(
          Array.from({ length: 32 }, () => ({ kind: "internal-user", userId })),
        );
        expect(
          previewTemplateRoleBindings(manifest, [
            ...input,
            { roleId: "bound_role_0", kind: "internal-user", userId },
          ]),
        ).toEqual(invalid);
      },
      (manifest) => {
        manifest.roles = Array.from({ length: 32 }, (_, index) => ({
          id: `bound_role_${index}`,
          kind: "internal-producer",
          label: { fa: "نقش", de: "Rolle", en: "Role" },
        }));
        manifest.deliverables = [];
        manifest.intents = [];
      },
    ),
  );

  it(
    "canonicalizes UUIDs without reordering or changing caller input",
    withManifest((manifest) => {
      const input = mappings();
      const before = structuredClone({ manifest, input });
      const result = previewTemplateRoleBindings(manifest, input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.roles.map(({ roleId, binding }) => ({ roleId, binding }))).toEqual(
        expectedMappedBindings,
      );
      expect({ manifest, input }).toEqual(before);
    }),
  );

  it(
    "shows the exact five role uses and ancestor-deliverable reviews",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, []);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        Object.fromEntries(result.value.roles.map((role) => [role.roleId, role.uses])),
      ).toEqual(expectedUses);
    }),
  );

  it(
    "preserves offsets in intent order without installation or dates",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, mappings());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.offsetAssumptions).toEqual(expectedOffsets);
      expect(result.value).not.toHaveProperty("canInstall");
      expect(result.value).not.toHaveProperty("installReceipt");
      expect(result.value).not.toHaveProperty("dates");
    }),
  );

  it(
    "allows repeated identities across distinct declared roles",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, [
        { roleId: "producer", kind: "internal-user", userId },
        { roleId: "reviewer", kind: "internal-user", userId },
        { roleId: "designer", kind: "external-contact", personId },
        { roleId: "editor", kind: "external-contact", personId },
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.roles.map((role) => role.binding)).toEqual([
        { kind: "internal-user", userId },
        { kind: "external-contact", personId },
        { kind: "external-contact", personId },
        { kind: "internal-user", userId },
        null,
      ]);
    }),
  );

  it(
    "keeps equal UUID bytes in distinct identity namespaces",
    withManifest((manifest) => {
      const result = previewTemplateRoleBindings(manifest, [
        { roleId: "producer", kind: "internal-user", userId },
        { roleId: "designer", kind: "external-contact", personId: userId },
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.roles.find((role) => role.roleId === "producer")?.binding).toEqual({
        kind: "internal-user",
        userId,
      });
      expect(result.value.roles.find((role) => role.roleId === "designer")?.binding).toEqual({
        kind: "external-contact",
        personId: userId,
      });
    }),
  );

  it(
    "rejects duplicate, unknown, case-changed and wrong-kind roles",
    withManifest((manifest) => {
      for (const input of invalidRoleSelections()) {
        expect(previewTemplateRoleBindings(manifest, input)).toEqual(invalid);
      }
    }),
  );

  it(
    "rejects malformed tags, identities and extra authority fields",
    withManifest((manifest) => {
      for (const input of malformedBindings()) {
        expect(previewTemplateRoleBindings(manifest, input)).toEqual(invalid);
      }
    }),
  );

  it(
    "isolates output edits from inputs and future previews",
    withManifest((manifest) => {
      const input = mappings();
      const before = structuredClone({ manifest, input });
      const first = previewTemplateRoleBindings(manifest, input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const original = structuredClone(first.value);
      const producer = first.value.roles.find((role) => role.roleId === "producer");
      const assumption = first.value.offsetAssumptions[0];
      expect(producer).toBeDefined();
      expect(assumption).toBeDefined();
      if (producer === undefined || assumption === undefined) return;
      if (producer.binding !== null) Reflect.set(producer.binding, "userId", otherUserId);
      Reflect.set(producer.uses, "0", { changed: true });
      Reflect.set(assumption.dueOffset, "days", 100);
      expect({ manifest, input }).toEqual(before);
      expect(previewTemplateRoleBindings(manifest, input)).toEqual({ ok: true, value: original });
    }),
  );

  it(
    "isolates prior output without freezing caller arrays or objects",
    withManifest((manifest) => {
      const input = [{ roleId: "producer", kind: "internal-user", userId }];
      const result = previewTemplateRoleBindings(manifest, input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const value of [...objectsIn(manifest), ...objectsIn(input)]) {
        expect(Object.isFrozen(value)).toBe(false);
      }
      const original = structuredClone(result.value);
      const binding = input[0];
      const intent = manifest.intents[0];
      expect(binding).toBeDefined();
      expect(intent).toBeDefined();
      if (binding === undefined || intent === undefined) return;
      expect(Reflect.set(binding, "userId", otherUserId)).toBe(true);
      expect(Reflect.set(intent.dueOffset, "days", -2)).toBe(true);
      expect(result.value).toEqual(original);
      const next = previewTemplateRoleBindings(manifest, input);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(next.value.roles.find((role) => role.roleId === "producer")?.binding).toEqual({
        kind: "internal-user",
        userId: otherUserId,
      });
      expect(next.value.offsetAssumptions[0]).toEqual({
        intentId: "brief_followup",
        dueOffset: offset(-2),
      });
    }),
  );
});

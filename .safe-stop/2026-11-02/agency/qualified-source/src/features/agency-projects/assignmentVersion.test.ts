import { describe, expect, it } from "vitest";
import { acceptance, command, snapshot, staffUserId } from "./assignmentFixtures";
import { transitionAssignment } from "./assignmentLifecycle";

describe("assignment submission version policy", () => {
  it("records the first actual submission after acceptance without inventing an earlier version", () => {
    const unsubmitted = { ...snapshot(), versionReference: null };
    const accepted = transitionAssignment(unsubmitted, command("record-acceptance"), "active");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const submitted = transitionAssignment(
      accepted.value.next,
      {
        action: "submit",
        expectedRevision: 3,
        recordedByUserId: staffUserId,
        submittedVersionReference: "مدل-۱ / Modell-v1",
      },
      "active",
    );
    expect(submitted).toMatchObject({
      ok: true,
      value: {
        next: {
          state: "submitted",
          revision: 4,
          versionReference: "مدل-۱ / Modell-v1",
          acceptance,
          approval: null,
        },
        receipt: { previousVersionReference: null, versionReference: "مدل-۱ / Modell-v1" },
      },
    });
    expect(accepted.value.next.versionReference).toBeNull();
  });

  it("records the new submitted version and retains the prior reference in the receipt", () => {
    const current = Object.freeze(snapshot("working"));
    expect(
      transitionAssignment(
        current,
        {
          action: "submit",
          expectedRevision: 2,
          recordedByUserId: staffUserId,
          submittedVersionReference: "model-v2",
        },
        "active",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        next: { versionReference: "model-v2", approval: null },
        receipt: { previousVersionReference: "model-v1", versionReference: "model-v2" },
      },
    });
    expect(current.versionReference).toBe("model-v1");
  });

  it.each(["", "  "])("requires an identified submitted version", (submittedVersionReference) => {
    expect(
      transitionAssignment(
        snapshot("working"),
        {
          action: "submit",
          expectedRevision: 2,
          recordedByUserId: staffUserId,
          submittedVersionReference,
        },
        "active",
      ),
    ).toEqual({ ok: false, error: "submission_version_required" });
  });
});

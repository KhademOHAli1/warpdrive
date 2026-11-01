import type { users } from "@/db/schema/identity";
import type { PermSetUser } from "@/features/permissions/effective";

type StaffFacts = Pick<typeof users.$inferSelect, "id" | "isActive" | "invitedAt">;

export const creationIds = {
  creator: "abcdefab-1234-4abc-8def-1234567890ab",
  owner: "bcdefabc-2345-4bcd-9efa-234567890abc",
  other: "cdefabcd-3456-4cde-abcd-345678901abc",
};

export function creationInput(type: PermSetUser["type"] = "regular") {
  const actor: PermSetUser = {
    id: creationIds.creator,
    type,
    isActive: true,
    groupIds: new Set(),
    flags: new Set(["project.create"]),
  };
  const creator: StaffFacts = { id: creationIds.creator, isActive: true, invitedAt: null };
  const selectedOwner: StaffFacts = { id: creationIds.owner, isActive: true, invitedAt: null };
  return { actor, creator, selectedOwner };
}

export function expectedCreationPlan() {
  return {
    ownerUserId: creationIds.owner,
    initial: { state: "planned", revision: 0, archivedFrom: null },
    creatorMembership: {
      userId: creationIds.creator,
      projectEdit: true,
      assignmentCoordinate: false,
    },
  };
}

export function globalCreateCases() {
  const regularMissing = creationInput();
  regularMissing.actor.flags = new Set();
  const regularOther = creationInput();
  regularOther.actor.flags = new Set(["permissions.manage"]);
  const adminMissing = creationInput("admin");
  adminMissing.actor.flags = new Set();
  const adminOther = creationInput("admin");
  adminOther.actor.flags = new Set(["deal.create"]);
  const inactiveRegular = creationInput();
  inactiveRegular.actor.isActive = false;
  const inactiveAdmin = creationInput("admin");
  inactiveAdmin.actor.flags = new Set();
  inactiveAdmin.actor.isActive = false;
  return [
    { name: "regular without create", input: regularMissing, allowed: false },
    { name: "regular permission manager without create", input: regularOther, allowed: false },
    { name: "regular explicit create", input: creationInput(), allowed: true },
    { name: "active native admin without flags", input: adminMissing, allowed: true },
    { name: "active native admin with unrelated flags", input: adminOther, allowed: true },
    { name: "inactive regular with create", input: inactiveRegular, allowed: false },
    { name: "inactive native admin", input: inactiveAdmin, allowed: false },
  ];
}

export function ineligibleStaffCases() {
  return (["regular", "admin"] as const).flatMap((type) =>
    (["creator", "selectedOwner"] as const).flatMap((party) => {
      const inactive = creationInput(type);
      inactive[party].isActive = false;
      const invited = creationInput(type);
      invited[party].invitedAt = new Date("2026-11-01T00:00:00.000Z");
      return [
        { name: `${type} with inactive ${party}`, input: inactive },
        { name: `${type} with invited ${party}`, input: invited },
      ];
    }),
  );
}

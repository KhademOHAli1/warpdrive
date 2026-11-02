import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  activities,
  activityGuests,
  activityParticipants,
  activityTypes,
  changeLogs,
  comments,
  customFieldDefs,
  dealParticipants,
  deals,
  files,
  leads,
  notes,
  organizations,
  persons,
  privacyCases,
  users,
} from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { seedDiscoveryMail } from "./discoveryMail.test-helpers";
import { verifyPrivacyCaseIdentity } from "./identity";

export async function discoveryFixture(h: TestDb) {
  const authority = await authorityFixture(h, ["case.review", "case.disclose"]);
  const [other] = await h.db
    .insert(users)
    .values({ email: `other-${randomUUID()}@example.test`, name: "Other owner" })
    .returning();
  assert(other !== undefined);
  const [organization] = await h.db
    .insert(organizations)
    .values({ name: "PRIVATE-ORGANIZATION-SENTINEL", ownerId: other.id, visibilityLevel: "owner" })
    .returning();
  assert(organization !== undefined);
  const sharedAddress = `shared-${randomUUID()}@example.test`;
  const aliasAddress = `stored-alias-${randomUUID()}@example.test`;
  const personRows = await h.db
    .insert(persons)
    .values([
      {
        name: "PRIVATE-SUBJECT-SENTINEL",
        primaryEmail: sharedAddress,
        emails: [
          { label: "stored primary", value: sharedAddress },
          { label: "stored alias", value: aliasAddress },
        ],
        ownerId: other.id,
        orgId: organization.id,
        visibilityLevel: "owner",
        deletedAt: new Date(),
      },
      {
        name: "Different shared-address subject",
        primaryEmail: sharedAddress,
        ownerId: authority.user.id,
        orgId: organization.id,
        visibilityLevel: "all",
      },
      {
        name: "Unrelated owned subject",
        primaryEmail: `unrelated-${randomUUID()}@example.test`,
        ownerId: authority.user.id,
        visibilityLevel: "all",
      },
    ])
    .returning();
  const [subject, sharedSubject, unrelatedSubject] = personRows;
  assert(subject !== undefined && sharedSubject !== undefined && unrelatedSubject !== undefined);
  const seeded = await seedPipelineWithStages(h.db, ["Discovery"]);
  const stage = seeded.stages[0];
  assert(stage !== undefined);
  const customKey = `reviewed_person_${subject.id.replaceAll("-", "")}`;
  const baseDeal = {
    pipelineId: seeded.pipeline.id,
    stageId: stage.id,
    visibilityLevel: "all" as const,
    ownerId: authority.user.id,
  };
  const dealRows = await h.db
    .insert(deals)
    .values([
      {
        ...baseDeal,
        title: "PRIVATE-DIRECT-DEAL-SENTINEL",
        personId: subject.id,
        ownerId: other.id,
        archivedAt: new Date(),
        deletedAt: new Date(),
      },
      { ...baseDeal, title: "Shared participant deal", personId: sharedSubject.id },
      { ...baseDeal, title: "PRIVATE-UNRELATED-OWNED-SENTINEL", personId: unrelatedSubject.id },
      { ...baseDeal, title: "Ambiguous person's deal", personId: sharedSubject.id },
      {
        ...baseDeal,
        title: "Reverse custom reference",
        customFields: { [customKey]: subject.id },
      },
    ])
    .returning();
  const [directDeal, participantDeal, unrelatedDeal, ambiguousDeal, customDeal] = dealRows;
  assert(
    directDeal !== undefined &&
      participantDeal !== undefined &&
      unrelatedDeal !== undefined &&
      ambiguousDeal !== undefined &&
      customDeal !== undefined,
  );
  await h.db.insert(dealParticipants).values({ dealId: participantDeal.id, personId: subject.id });
  await h.db.insert(customFieldDefs).values({
    targetEntity: "deal",
    type: "person",
    key: customKey,
    name: "Person reference",
    archivedAt: new Date(),
  });
  const [lead] = await h.db
    .insert(leads)
    .values({
      title: "Direct lead",
      personId: subject.id,
      ownerId: other.id,
      visibilityLevel: "all",
    })
    .returning();
  const [type] = await h.db
    .insert(activityTypes)
    .values({
      key: `discovery-${randomUUID()}`,
      name: `Discovery-${randomUUID()}`,
      icon: "calendar",
      order: 0,
    })
    .returning();
  assert(lead !== undefined && type !== undefined);
  const activityRows = await h.db
    .insert(activities)
    .values([
      {
        typeId: type.id,
        subject: "Direct activity",
        personId: subject.id,
        ownerId: other.id,
        assigneeId: other.id,
      },
      {
        typeId: type.id,
        subject: "Participant deal activity",
        dealId: participantDeal.id,
        ownerId: other.id,
        assigneeId: other.id,
      },
      { typeId: type.id, subject: "Guest activity", ownerId: other.id, assigneeId: other.id },
      {
        typeId: type.id,
        subject: "Unrelated owned activity",
        ownerId: authority.user.id,
        assigneeId: authority.user.id,
      },
    ])
    .returning();
  const [directActivity, dealActivity, guestActivity, ownedActivity] = activityRows;
  assert(
    directActivity !== undefined &&
      dealActivity !== undefined &&
      guestActivity !== undefined &&
      ownedActivity !== undefined,
  );
  await h.db.insert(activityGuests).values({ activityId: guestActivity.id, personId: subject.id });
  await h.db
    .insert(activityParticipants)
    .values({ activityId: guestActivity.id, userId: authority.user.id });
  const [note] = await h.db
    .insert(notes)
    .values({
      entityType: "deal",
      entityId: directDeal.id,
      body: "PRIVATE-NOTE-SENTINEL",
      authorId: other.id,
      deletedAt: new Date(),
    })
    .returning();
  assert(note !== undefined);
  const [comment] = await h.db
    .insert(comments)
    .values({ noteId: note.id, body: "PRIVATE-COMMENT-SENTINEL", authorId: other.id })
    .returning();
  const [history] = await h.db
    .insert(changeLogs)
    .values({
      entityType: "person",
      entityId: subject.id,
      field: "primaryEmail",
      oldValue: "PRIVATE-HISTORICAL-SENTINEL",
      newValue: sharedAddress,
      actorId: other.id,
    })
    .returning();
  const [file] = await h.db
    .insert(files)
    .values({
      entityType: "person",
      entityId: subject.id,
      filename: "PRIVATE-FILENAME-SENTINEL.txt",
      s3Key: `synthetic/${randomUUID()}`,
      sizeBytes: 1,
      contentType: "text/plain",
      uploadedBy: authority.user.id,
    })
    .returning();
  assert(comment !== undefined && history !== undefined && file !== undefined);
  const mail = await seedDiscoveryMail(h, authority.user, subject.id, sharedAddress);
  const verified = await verifyPrivacyCaseIdentity(
    h.db,
    authority.actor,
    {
      caseId: authority.privacyCase.id,
      expectedVersion: 1,
      commandId: randomUUID(),
      subject: { kind: "contact", referenceId: subject.id },
      recipient: { channel: "email", address: sharedAddress },
      evidence: {
        trustedChannel: "organizational_record",
        evidenceRef: "synthetic-discovery-verification",
        observedAt: new Date().toISOString(),
        confirmedSubject: true,
        confirmedRecipient: true,
      },
    },
    authoritySignal(),
  );
  assert(verified.ok);
  const [privacyCase] = await h.db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, authority.privacyCase.id));
  assert(privacyCase !== undefined);
  return {
    authority,
    subject,
    sharedSubject,
    unrelatedSubject,
    organization,
    directDeal,
    participantDeal,
    unrelatedDeal,
    ambiguousDeal,
    customDeal,
    lead,
    directActivity,
    dealActivity,
    guestActivity,
    ownedActivity,
    note,
    comment,
    history,
    file,
    ...mail,
    privacyCase,
    aliasAddress,
  };
}

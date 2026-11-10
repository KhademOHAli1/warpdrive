import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedMailMigrationBaseline, seedMailMigrationPlatform } from "./mailMigrationQualificationFixtures";
import { assertQualificationMailGuards, assertQualificationWorkflowGuards } from "./mailMigrationQualificationGuards";
import { MailMigrationQualificationHarness, qualificationMigrate, qualificationQuery as query } from "./mailMigrationQualification.test-helpers";
import { assertLegacyMailQualification, assertQualifiedProviderCredentials, seedQualifiedProviderState } from "./mailMigrationQualificationNative";
import { assertQualification90Upgrade, assertQualificationAliases } from "./mailMigrationQualificationAlias";
import { assertBlockedQualificationArchive } from "./mailMigrationQualificationSafety";
import { assertQualificationBaselineGuards, assertQualificationJournal, captureQualificationGuardSet, captureQualificationGuards, captureQualificationRows } from "./mailMigrationQualificationSnapshot";

let harness: MailMigrationQualificationHarness | undefined;
const current = () => {
  if (harness === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT,"Mail migration qualification fixture is unavailable");
  return harness;
};

describe.sequential("actual mail database migration and restore qualification",()=>{
  beforeAll(async()=> { harness=await MailMigrationQualificationHarness.start(AbortSignal.timeout(180_000)); },180_000);
  afterAll(async()=> { await harness?.close(); },60_000);
  it("applies the complete actual journal to a clean owned PostgreSQL16 database and reruns without changes",async()=>{
    const h=current();const signal=AbortSignal.timeout(120_000);const database=await h.database(signal);
    await qualificationMigrate(database,h.sources.folder,signal);
    await assertQualificationJournal(database.pool,h.sources,signal);
    const required=await query<{table_name:string}>(database.pool,"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','auth_accounts','email_accounts','mail_folders','mail_message_locators','integration_connections','workflows','workflow_versions','workflow_runs') ORDER BY table_name",[],signal);
    expect(required.rows).toHaveLength(9);
    const state=await captureQualificationRows(database.pool,signal);
    const guards=await captureQualificationGuards(database.pool,signal);
    await qualificationMigrate(database,h.sources.folder,signal);
    await assertQualificationJournal(database.pool,h.sources,signal);
    expect(await captureQualificationRows(database.pool,signal)).toEqual(state);
    expect(await captureQualificationGuards(database.pool,signal)).toBe(guards);
  },180_000);

  it.each([82,84] as const)("upgrades exact baseline%s fixtures, preserves authority and data, then proves a real custom-archive restore",async(baseline)=>{
    const h=current();const signal=AbortSignal.timeout(180_000);const source=await h.database(signal);
    await h.prefix(source,baseline,signal);
    const fixture=await seedMailMigrationBaseline(source.pool,signal);
    if(baseline===84) await seedMailMigrationPlatform(source.pool,fixture.ids,signal);
    const historical=await captureQualificationRows(source.pool,signal);
    const historicalGuards=await captureQualificationGuardSet(source.pool,signal);
    await qualificationMigrate(source,h.sources.folder,signal);
    await assertQualificationJournal(source.pool,h.sources,signal);
    expect(await captureQualificationRows(source.pool,signal,historical)).toEqual(historical);
    assertQualificationBaselineGuards(historicalGuards,await captureQualificationGuardSet(source.pool,signal));
    await assertLegacyMailQualification(source,fixture.ids,signal);
    await qualificationMigrate(source,h.sources.folder,signal);
    await assertQualificationJournal(source.pool,h.sources,signal);
    expect(await captureQualificationRows(source.pool,signal,historical)).toEqual(historical);
    if(baseline===82) await seedMailMigrationPlatform(source.pool,fixture.ids,signal);
    await seedQualifiedProviderState(source.pool,fixture.ids,signal);
    await assertQualificationAliases(source.pool,fixture.ids,signal);
    await assertQualifiedProviderCredentials(source,fixture.ids,signal);
    await assertQualificationWorkflowGuards(source.pool,fixture.ids,signal);
    await assertQualificationMailGuards(source.pool,fixture.ids,signal);
    const before=await captureQualificationRows(source.pool,signal);
    const guards=await captureQualificationGuards(source.pool,signal);
    const restored=await h.dumpRestore(source,signal);
    expect(await captureQualificationRows(restored.database.pool,signal)).toEqual(before);
    expect(await captureQualificationGuards(restored.database.pool,signal)).toBe(guards);
    await assertQualificationJournal(restored.database.pool,h.sources,signal);
    await assertLegacyMailQualification(restored.database,fixture.ids,signal);
    await assertQualifiedProviderCredentials(restored.database,fixture.ids,signal);
    await assertQualificationAliases(restored.database.pool,fixture.ids,signal);
    await assertQualificationWorkflowGuards(restored.database.pool,fixture.ids,signal);
    await assertQualificationMailGuards(restored.database.pool,fixture.ids,signal);
    await qualificationMigrate(restored.database,h.sources.folder,signal);
    await assertQualificationJournal(restored.database.pool,h.sources,signal);
    expect(await captureQualificationRows(restored.database.pool,signal)).toEqual(before);
    // Non-secret evidence only. Private object bytes and external providers are deliberately
    // outside this database/key-recovery qualification and retain their separate gates.
    process.stdout.write(`MAIL_MIGRATION_QUALIFICATION ${JSON.stringify({baseline,target:h.sources.journal.entries.at(-1),inputManifest:h.sources.manifest,preservedHistoricalTables:Object.keys(historical).length,restoredTables:Object.keys(before).length,guardHash:guards,sourceFingerprint:true,...restored.evidence})}\n`);
  },240_000);

  it("upgrades actual90 locators through required91 without inventing historical hashes or replacing UUIDs",async()=>{
    await assertQualification90Upgrade(current(),AbortSignal.timeout(180_000));
  },240_000);
});

// These destructive cases start only after the functional fixture has closed. Each owns
// a fresh container, since proving a deadline/abort necessarily removes that backend.
describe.sequential("actual blocked archive termination qualification",()=>{
  it.each(["deadline","abort"] as const)("terminates a real lock-blocked pg_dump on %s and confirms exact owned-container removal",async(mode)=>{
    await assertBlockedQualificationArchive(mode,AbortSignal.timeout(150_000));
  },180_000);
});

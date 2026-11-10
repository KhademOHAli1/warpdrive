import type { TestDb } from "@/test/db";

// Let the current engine generate ordinary successful fixture prefixes. Remove
// these temporary columns before running the exact historical 0100 upgrade, so
// the old schema, uniqueness constraint, and journal are the real predecessors.
export async function addCurrentColumnsForLegacyFixture({ pool }: TestDb) {
  await pool.query(`
    ALTER TABLE workflow_runs ADD COLUMN iterator_frame jsonb;
    ALTER TABLE workflow_steps ADD COLUMN iteration_index smallint DEFAULT -1 NOT NULL;
    ALTER TABLE workflow_steps ADD COLUMN outcome text DEFAULT 'succeeded' NOT NULL;
    ALTER TABLE workflow_steps ADD COLUMN error_id text;
  `);
}

export async function restoreLegacyWorkflowColumns({ pool }: TestDb) {
  await pool.query(`
    ALTER TABLE workflow_steps DROP COLUMN error_id, DROP COLUMN outcome, DROP COLUMN iteration_index;
    ALTER TABLE workflow_runs DROP COLUMN iterator_frame;
  `);
}

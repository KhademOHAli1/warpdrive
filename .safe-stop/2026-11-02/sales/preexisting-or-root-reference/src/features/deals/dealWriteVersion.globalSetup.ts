import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import baseSetup from "../../../vitest.globalSetup";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

// Private qualification overlay while the integrator reconciles reserved 0101.
// The canonical migration journal and installed-history receipts stay unchanged.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const teardown = await baseSetup(project);
  let pool: Pool | undefined;
  try {
    const connection = project.getProvidedContext().testPg;
    pool = new Pool({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.template,
      max: 1,
      connectionTimeoutMillis: 2_000,
      query_timeout: 5_000,
    });
    await installDealWriteVersionFixture(pool);
    const closing = pool.end();
    pool = undefined;
    await closing;
    return teardown;
  } catch (error) {
    const failures: unknown[] = [error];
    if (pool !== undefined) {
      try {
        await pool.end();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    try {
      await teardown();
    } catch (teardownError) {
      failures.push(teardownError);
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "deal version fixture setup and cleanup failed");
    throw error;
  }
}

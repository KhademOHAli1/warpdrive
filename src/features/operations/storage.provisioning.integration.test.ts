import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { operationsInstallation, operationsSources } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import {
  OPERATIONS_SOURCE_LIMIT,
  provisionOperationsSource,
  rotateOperationsSource,
} from "./storage";

const script = fileURLToPath(new URL("../../../scripts/operations-source.ts", import.meta.url));
const signal = () => AbortSignal.timeout(15_000);

async function invoke(path: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--no-env-file", script, "enroll", path],
      {
        env: { NODE_ENV: "test" },
        encoding: "buffer",
        maxBuffer: 8_192,
        timeout: 20_000,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : error.code;
        if (typeof code === "number" && error?.killed !== true && error?.signal == null) {
          resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
        } else {
          reject(new Error("Operations source fixture command did not exit normally"));
        }
      },
    );
  });
}

it("provisions through the private CLI once, adopts a lost reply and preserves the live binding", async () => {
  const { db, pool, url, close } = await makeTestDb();
  const directory = await mkdtemp(join(await realpath(tmpdir()), "wd-source-provision-"));
  const configPath = join(directory, "source.json");
  const roleName = `provision_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const binding = {
    installationId: randomUUID(),
    sourceId: randomUUID(),
    generationId: randomUUID(),
  };
  const role = "host_collector" as const;
  async function writeConfiguration(databaseUrl: string) {
    await writeFile(configPath, JSON.stringify({ databaseUrl, binding, role }), { mode: 0o600 });
  }
  try {
    await writeConfiguration(url);
    const owner = await invoke(configPath);
    expect(owner.code).toBe(1);
    expect(owner.stdout).toBe("");
    expect(await db.select().from(operationsInstallation)).toHaveLength(0);

    await pool.query(
      `CREATE ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${password}'`,
    );
    await pool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ${roleName};
      GRANT SELECT, INSERT ON operations_installation, operations_sources TO ${roleName};
      GRANT UPDATE (singleton) ON operations_installation TO ${roleName};
      GRANT UPDATE (id) ON operations_sources TO ${roleName};`);
    const connection = new URL(url);
    connection.hostname = "127.0.0.1";
    connection.username = roleName;
    connection.password = password;
    await writeConfiguration(connection.href);

    // Consume concurrent outcomes, then discard the original successful reply as
    // an operator would after a broken terminal/transport connection.
    const replies = await Promise.all([invoke(configPath), invoke(configPath)]);
    expect(replies.map(({ code }) => code)).toEqual([0, 0]);
    expect(replies.map(({ stdout }) => JSON.parse(stdout))).toEqual(
      expect.arrayContaining([
        { status: "created", binding },
        { status: "existing", binding },
      ]),
    );
    await db
      .update(operationsSources)
      .set({ highestSequence: 7, admissionState: "storage_pressure" })
      .where(eq(operationsSources.id, binding.sourceId));
    expect(await invoke(configPath)).toEqual({
      code: 0,
      stdout: `${JSON.stringify({ binding, status: "existing" })}\n`,
      stderr: "",
    });
    const [current] = await db.select().from(operationsSources);
    expect(current).toMatchObject({
      id: binding.sourceId,
      highestSequence: 7,
      admissionState: "storage_pressure",
    });
    expect(await db.select().from(operationsSources)).toHaveLength(1);
    expect(await db.select().from(operationsInstallation)).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await close();
    // The fixture database (and its grants) has already gone away.
    const { Pool } = await import("pg");
    const admin = new URL(url);
    admin.pathname = "/postgres";
    const adminPool = new Pool({ connectionString: admin.href, max: 1 });
    try {
      await adminPool.query(`DROP ROLE IF EXISTS ${roleName}`);
    } finally {
      await adminPool.end();
    }
  }
}, 40_000);

it("rejects wrong installation, role and retired generation before changing a source", async () => {
  const { db, close } = await makeTestDb();
  try {
    const binding = {
      installationId: randomUUID(),
      sourceId: randomUUID(),
      generationId: randomUUID(),
    };
    const role = "host_collector" as const;
    await provisionOperationsSource(db, { binding, role }, signal());
    const requests = [
      { binding: { ...binding, installationId: randomUUID() }, role },
      { binding, role: "application_sampler" as const },
      { binding: { ...binding, generationId: randomUUID() }, role },
    ];
    for (const request of requests) {
      await expect(provisionOperationsSource(db, request, signal())).rejects.toThrow(
        /identity differs|binding differs/u,
      );
    }
    await rotateOperationsSource(db, binding, signal());
    await expect(provisionOperationsSource(db, { binding, role }, signal())).rejects.toThrow(
      /binding differs/u,
    );
    await db
      .update(operationsSources)
      .set({ active: false })
      .where(eq(operationsSources.id, binding.sourceId));
    const rows = await db.select().from(operationsSources);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: binding.sourceId, role, active: false });
  } finally {
    await close();
  }
});

it("recovers the existing binding at the cap without consuming or reassigning inactive slots", async () => {
  const { db, close } = await makeTestDb();
  try {
    const installationId = randomUUID();
    const role = "recovery_verifier" as const;
    const bindings = Array.from({ length: OPERATIONS_SOURCE_LIMIT }, () => ({
      installationId,
      sourceId: randomUUID(),
      generationId: randomUUID(),
    }));
    for (const binding of bindings)
      await provisionOperationsSource(db, { binding, role }, signal());
    const active = bindings[0]!;
    expect(await provisionOperationsSource(db, { binding: active, role }, signal())).toEqual({
      binding: active,
      status: "existing",
    });
    const inactive = bindings[1]!;
    await db
      .update(operationsSources)
      .set({ active: false })
      .where(eq(operationsSources.id, inactive.sourceId));
    const fresh = { installationId, sourceId: randomUUID(), generationId: randomUUID() };
    await expect(provisionOperationsSource(db, { binding: fresh, role }, signal())).rejects.toThrow(
      /budget exhausted/u,
    );
    await expect(
      provisionOperationsSource(db, { binding: inactive, role }, signal()),
    ).rejects.toThrow(/binding differs/u);
    expect(await db.select().from(operationsSources)).toHaveLength(OPERATIONS_SOURCE_LIMIT);
  } finally {
    await close();
  }
});

import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { createSeaweedReadiness } from "./exportObjectStoreReadiness.test-helpers";

type Readiness = ReturnType<typeof createSeaweedReadiness>;
type Container = Parameters<Readiness["wait"]>[0];
const REVISION = "ec8f9793502c59ce3381cc4151bfc0806afd92e8";
const ADVERTISED = "127.0.0.1:8888.18888";
const HTTP = "127.0.0.1:8888";
const VERSION = "1793524041000000000";
const PRIVATE = "PRIVATE-PROTOCOL-SENTINEL";

// Exact pinned source contracts, not captured provider output or storage qualification:
// weed/cluster/lock_ring_manager.go:146,167-176 uses UnixNano int64 and []string.
// weed/filer/filer.go:231-237 uses []pb.ServerAddress, whose String hides the gRPC suffix.
// weed/wdclient/masterclient.go:409 prints the []string received from the master.
function ringLines(version = VERSION, advertised = ADVERTISED, applied = HTTP) {
  const header = "I1101 10:07:35.123456";
  return [
    `${header} lock_ring_manager.go:146 LockRing: broadcasting ring update for group "" version ${version}: [${advertised}]`,
    `${header} filer.go:236 LockRing: applying master ring update v${version}: [${applied}]`,
    `${header} masterclient.go:409 LockRing: s3@127.0.0.1:18333 received ring update v${version}: [${advertised}]`,
  ];
}

// cluster.ps prints raw node.Address, version.Version() and a UTC creation instant.
// weed/shell/command_cluster_ps.go:100-115; weed/util/version/constants.go:10-23.
function membership(member = ADVERTISED, revision = REVISION) {
  return [
    "* s3 servers 1",
    `  * 127.0.0.1:18333 (8000GB 4.50 ${revision})`,
    "* filers 1",
    `  * ${member} (8000GB 4.50 ${revision}) 2026-11-01 09:07:35 +0000 UTC`,
    "    signature: -123456",
    `* filer ${member} metadata sync time`,
    "* volume servers 1",
  ].join("\n");
}

function observe(readiness: Readiness, lines = ringLines()) {
  return lines.map((line) => readiness.observeLine(line));
}

async function finish(readiness: Readiness, signal: AbortSignal, stdout = membership()) {
  const exec = vi.fn<Container["exec"]>(() =>
    Promise.resolve({ stdout, stderr: PRIVATE, output: `${stdout}\n${PRIVATE}`, exitCode: 0 }),
  );
  const report = await readiness.wait(
    { exec } as unknown as Container,
    performance.now() + 50,
    signal,
  );
  return { report, exec };
}

describe("pinned SeaweedFS readiness wire-format fixtures, no storage transport", () => {
  it("accepts the raw advertised filer address and role-specific member rendering", async ({
    signal,
  }) => {
    const readiness = createSeaweedReadiness();
    const events = observe(readiness);
    expect(events.map((event) => event?.label)).toEqual([
      "ring_master_broadcast",
      "ring_filer_applying",
      "ring_s3_received",
    ]);
    const { report, exec } = await finish(readiness, signal);
    expect(report).toMatchObject({
      state: "ready",
      polls: 1,
      probeKind: "ok",
      membership: {
        filerCount: 1,
        expectedMemberMatches: true,
        groupMatches: true,
        configRead: true,
        version: "4.50",
        revisionMatchesPinned: true,
      },
    });
    expect(report.ring.map((event) => event.version)).toEqual([VERSION, VERSION, VERSION]);
    expect(report.ring.every((event) => event.expectedMemberMatches)).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|127\.0\.0\.1|8000GB/u);
  });

  it.each(["1", "9007199254740992", VERSION, "9223372036854775807"])(
    "preserves valid positive int64 version %s as an opaque decimal string",
    (version) => {
      const readiness = createSeaweedReadiness();
      const events = observe(readiness, ringLines(version));
      expect(events.map((event) => event?.version)).toEqual([version, version, version]);
      expect(readiness.snapshot().ring.map((event) => event.version)).toEqual([
        version,
        version,
        version,
      ]);
      expect(() => JSON.stringify(readiness.snapshot())).not.toThrow();
    },
  );

  it.each([
    "0",
    "-1",
    "+1",
    "01",
    "1.0",
    "1e3",
    "NaN",
    "9223372036854775808",
    "9999999999999999999999999999999999999999",
  ])("rejects noncanonical, nonpositive or overflowing int64 version %s", (version) => {
    const readiness = createSeaweedReadiness();
    expect(observe(readiness, ringLines(version)).every((event) => event === undefined)).toBe(true);
    expect(readiness.snapshot().ring).toEqual([]);
  });

  it("does not collapse neighboring nanosecond versions into the same rounded number", async ({
    signal,
  }) => {
    const readiness = createSeaweedReadiness();
    readiness.observeLine(ringLines(VERSION)[0] ?? "");
    readiness.observeLine(ringLines("1793524041000000001")[1] ?? "");
    readiness.observeLine(ringLines("1793524041000000001")[2] ?? "");
    const { report } = await finish(readiness, signal);
    expect(report.state).toBe("failed");
    expect(report.ring.map((event) => event.version)).toEqual([
      VERSION,
      "1793524041000000001",
      "1793524041000000001",
    ]);
  });

  it("reads the pinned short commit prefix from a correctly advertised filer row", async ({
    signal,
  }) => {
    const readiness = createSeaweedReadiness();
    observe(readiness);
    const { report } = await finish(
      readiness,
      signal,
      membership(ADVERTISED, REVISION.slice(0, 7)),
    );
    expect(report.state).toBe("ready");
    expect(report.membership).toMatchObject({
      expectedMemberMatches: true,
      version: "4.50",
      revisionMatchesPinned: true,
    });
  });

  for (const member of [
    "127.0.0.1:8888.18889",
    "127.0.0.1:8889.18888",
    "0.0.0.0:8888.18888",
    PRIVATE,
  ])
    it(`does not accept another advertised filer locator ${member}`, async ({ signal }) => {
      const readiness = createSeaweedReadiness();
      observe(readiness);
      const { report } = await finish(readiness, signal, membership(member));
      expect(report.state).toBe("failed");
      expect(report.membership?.expectedMemberMatches).toBe(false);
      expect(JSON.stringify(report)).not.toContain(PRIVATE);
    });

  it("does not turn valid formatting into readiness without all three ring events", async ({
    signal,
  }) => {
    const readiness = createSeaweedReadiness();
    const { report } = await finish(readiness, signal);
    expect(report.state).toBe("failed");
    expect(report.membership).toMatchObject({
      expectedMemberMatches: true,
      revisionMatchesPinned: true,
    });
    expect(report.ring).toEqual([]);
  });
});

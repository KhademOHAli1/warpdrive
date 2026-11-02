import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { createSeaweedReadiness } from "./exportObjectStoreReadiness.test-helpers";

type Readiness = ReturnType<typeof createSeaweedReadiness>;
type Container = Parameters<Readiness["wait"]>[0];
type ExecResult = Awaited<ReturnType<Container["exec"]>>;
const REVISION = "ec8f9793502c59ce3381cc4151bfc0806afd92e8";
const MEMBER = "127.0.0.1:8888.18888";
const HTTP_MEMBER = "127.0.0.1:8888";
const PRIVATE = "PRIVATE-READINESS-SENTINEL";

function ringLines(version = "1", members = MEMBER) {
  const header = "I1101 12:34:56.123456";
  const filerMembers = members === MEMBER ? HTTP_MEMBER : members;
  return [
    `${header} lock_ring_manager.go:158 LockRing: broadcasting ring update for group "" version ${version}: [${members}]`,
    `${header} filer.go:250 LockRing: applying master ring update v${version}: [${filerMembers}]`,
    `${header} masterclient.go:438 LockRing: s3@127.0.0.1:18333 received ring update v${version}: [${members}]`,
  ];
}

function observeReady(readiness: Readiness) {
  for (const line of ringLines()) readiness.observeLine(line);
}

function membershipOutput(
  options: { count?: number; member?: string; version?: string; config?: string } = {},
) {
  return [
    `* filers ${options.count ?? 1}`,
    `  * ${options.member ?? MEMBER} (${options.version ?? `8000GB 4.50 ${REVISION}`}) 2026-11-01 12:34:56 +0000 UTC`,
    options.config ?? "    signature: -123456",
    `* filer ${MEMBER} metadata sync time`,
    "* volume servers 1",
  ].join("\n");
}

function result(stdout: string, exitCode = 0): ExecResult {
  return { stdout, stderr: PRIVATE, output: `${stdout}\n${PRIVATE}`, exitCode };
}

function fakeContainer(stdout = membershipOutput(), exitCode = 0) {
  const exec = vi.fn<Container["exec"]>(() => Promise.resolve(result(stdout, exitCode)));
  return { container: { exec } as unknown as Container, exec };
}

async function finish(readiness: Readiness, stdout = membershipOutput(), exitCode = 0) {
  const fixture = fakeContainer(stdout, exitCode);
  const report = await readiness.wait(
    fixture.container,
    performance.now() + 50,
    AbortSignal.timeout(1000),
  );
  return { ...fixture, report };
}

describe("Seaweed diagnostic readiness parser fixtures (no storage transport)", () => {
  it("recognizes all three anchored positive events and exposes only allowed metadata", async () => {
    const readiness = createSeaweedReadiness();
    const labels = ringLines().map((line) => readiness.observeLine(line)?.label);
    expect(labels).toEqual(["ring_master_broadcast", "ring_filer_applying", "ring_s3_received"]);
    const { report, exec } = await finish(readiness);
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
    expect(report.ring).toHaveLength(3);
    expect(JSON.stringify(report)).not.toContain(PRIVATE);
    expect(JSON.stringify(report)).not.toContain(MEMBER);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["payload prefix", `payload ${ringLines()[0]}`],
    ["wrong source", ringLines()[0]?.replace("lock_ring_manager.go", "untrusted.go") ?? ""],
    ["wrong group", ringLines()[0]?.replace('group ""', 'group "other"') ?? ""],
    ["other client", ringLines()[2]?.replace("s3@", "adminShell@") ?? ""],
    ["generic content", "S3 payload contains LockRing: applying master ring update v1"],
  ])("rejects %s as positive ring evidence", (_name, line) => {
    const readiness = createSeaweedReadiness();
    expect(readiness.observeLine(line)).toBeUndefined();
    expect(readiness.snapshot().ring).toEqual([]);
  });

  it.each(["0", "-1", "NaN", "9223372036854775808"])(
    "rejects nonpositive, malformed or overflowing int64 ring version %s",
    (version) => {
      const readiness = createSeaweedReadiness();
      for (const line of ringLines(version)) expect(readiness.observeLine(line)).toBeUndefined();
      expect(readiness.snapshot().ring).toEqual([]);
    },
  );

  it.each(["", PRIVATE, `${MEMBER} ${PRIVATE}`])(
    "fails closed for empty, wrong or extra ring members (%s)",
    async (members) => {
      const readiness = createSeaweedReadiness();
      for (const line of ringLines("1", members)) readiness.observeLine(line);
      const { report } = await finish(readiness);
      expect(report.state).toBe("failed");
      expect(report.ring.every((event) => event.expectedMemberMatches)).toBe(false);
      expect(JSON.stringify(report)).not.toContain(PRIVATE);
    },
  );

  it("requires matching versions from every ring consumer", async () => {
    const readiness = createSeaweedReadiness();
    readiness.observeLine(ringLines("1")[0] ?? "");
    readiness.observeLine(ringLines("2")[1] ?? "");
    readiness.observeLine(ringLines("2")[2] ?? "");
    const { report } = await finish(readiness);
    expect(report.state).toBe("failed");
    expect(report.ring.map((event) => event.version)).toEqual(["1", "2", "2"]);
  });

  it("requires the S3 receipt event as well as master and filer evidence", async () => {
    const readiness = createSeaweedReadiness();
    for (const line of ringLines().slice(0, 2)) readiness.observeLine(line);
    const { report } = await finish(readiness);
    expect(report.state).toBe("failed");
    expect(report.ring).toHaveLength(2);
  });

  it.each([
    ["oversize", "x".repeat(32_769)],
    ["malformed", "* filers NaN"],
    ["negative count", "* filers -1"],
    ["excessive count", membershipOutput({ count: 9 })],
  ])("rejects %s CLI output", async (_name, output) => {
    const readiness = createSeaweedReadiness();
    observeReady(readiness);
    const { report } = await finish(readiness, output);
    expect(report).toMatchObject({ state: "failed", probeKind: "invalid" });
    expect(report.membership).toBeUndefined();
  });

  it.each([
    ["empty membership", "* filers 0\n* volume servers 1", { filerCount: 0 }],
    ["wrong member", membershipOutput({ member: PRIVATE }), { expectedMemberMatches: false }],
    [
      "wrong group",
      membershipOutput({ config: "    filer group: other\n    signature: 1" }),
      { groupMatches: false },
    ],
    [
      "missing config",
      membershipOutput({ config: "    failed to connect: private" }),
      { configRead: false },
    ],
    [
      "wrong version",
      membershipOutput({ version: `8000GB 4.51 ${REVISION}` }),
      { version: undefined },
    ],
    [
      "wrong revision",
      membershipOutput({ version: "8000GB 4.50 deadbeef" }),
      { revisionMatchesPinned: false },
    ],
  ] as const)("does not accept %s despite exit zero", async (_name, output, expected) => {
    const readiness = createSeaweedReadiness();
    observeReady(readiness);
    const { report } = await finish(readiness, output);
    expect(report).toMatchObject({ state: "failed", probeKind: "ok" });
    expect(report.membership).toMatchObject(expected);
    expect(JSON.stringify(report)).not.toContain(PRIVATE);
  });

  it.each([126, 127])("fails closed if the bounded CLI is unavailable (%s)", async (exitCode) => {
    const readiness = createSeaweedReadiness();
    observeReady(readiness);
    const { report } = await finish(readiness, membershipOutput(), exitCode);
    expect(report).toMatchObject({ state: "failed", probeKind: "unsupported" });
  });

  it.each([1, 137])("rejects a failed CLI command (%s)", async (exitCode) => {
    const readiness = createSeaweedReadiness();
    observeReady(readiness);
    const { report } = await finish(readiness, membershipOutput(), exitCode);
    expect(report).toMatchObject({ state: "failed", probeKind: "failed" });
  });

  it("sanitizes a rejected exec transport", async () => {
    const readiness = createSeaweedReadiness();
    const exec = vi.fn<Container["exec"]>(() =>
      Promise.reject(new DOMException(PRIVATE, "NetworkError")),
    );
    const report = await readiness.wait(
      { exec } as unknown as Container,
      performance.now() + 1000,
      AbortSignal.timeout(1000),
    );
    expect(report).toMatchObject({ state: "failed", probeKind: "exec_failed" });
    expect(JSON.stringify(report)).not.toContain(PRIVATE);
  });

  it("propagates cancellation while an exec response is pending", async () => {
    const readiness = createSeaweedReadiness();
    const controller = new AbortController();
    const reason = new DOMException("synthetic_cancel", "AbortError");
    let complete: ((value: ExecResult) => void) | undefined;
    const exec = vi.fn<Container["exec"]>(
      () =>
        new Promise<ExecResult>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = readiness.wait(
      { exec } as unknown as Container,
      performance.now() + 1000,
      controller.signal,
    );
    controller.abort(reason);
    try {
      await expect(pending).rejects.toBe(reason);
      expect(readiness.snapshot().state).toBe("failed");
    } finally {
      complete?.(result(membershipOutput()));
    }
  });

  it("bounds a stalled exec by the remaining startup budget", async () => {
    const readiness = createSeaweedReadiness();
    let complete: ((value: ExecResult) => void) | undefined;
    const exec = vi.fn<Container["exec"]>(
      () =>
        new Promise<ExecResult>((resolve) => {
          complete = resolve;
        }),
    );
    try {
      const report = await readiness.wait(
        { exec } as unknown as Container,
        performance.now() + 15,
        AbortSignal.timeout(1000),
      );
      expect(report).toMatchObject({ state: "failed", probeKind: "timeout", polls: 1 });
    } finally {
      complete?.(result(membershipOutput()));
    }
  });

  it("propagates an already-aborted signal even when the startup deadline has expired", async () => {
    const readiness = createSeaweedReadiness();
    const { container, exec } = fakeContainer();
    const controller = new AbortController();
    const reason = new DOMException("synthetic_cancel", "AbortError");
    controller.abort(reason);
    await expect(readiness.wait(container, performance.now() - 1, controller.signal)).rejects.toBe(
      reason,
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("issues only the fixed bounded metadata command, with no data-plane warm-up", async () => {
    const readiness = createSeaweedReadiness();
    observeReady(readiness);
    const { exec, report } = await finish(readiness);
    expect(report.state).toBe("ready");
    const command = exec.mock.calls[0]?.[0];
    expect(command).toEqual([
      "/bin/sh",
      "-c",
      "printf 'cluster.ps\\n' | /bin/busybox timeout -s KILL 2s /usr/bin/weed -logtostderr=true shell -debug=true -master=127.0.0.1:9333 -filer=127.0.0.1:8888 -filerGroup= -connectTimeout=1s",
    ]);
    expect(JSON.stringify(command)).not.toMatch(
      /\b(?:lock|unlock|assign|grow|put|upload|delete)\b/u,
    );
  });
});

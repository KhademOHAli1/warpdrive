import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { selectBuildEntries } from "../build-workers.mjs";
import { readCapabilityProfile } from "./web_functional_capabilities.mjs";
import { verifyWebFunctionalSource } from "./web_functional_source.mjs";
import { WEB_SOURCE_RULES } from "./web_inputs.mjs";

const LEAF = "src/app/(app)/[workspace]/SidebarView.tsx";
const MOUNT = "src/app/(app)/[workspace]/page.tsx";
const CAPABILITY = "src/components/shell/sidebarCapability.tsx";
const PROVIDER = `"use client";
export function useCompact(): boolean { return true; }
export function ProtectedAction() { return <button type="button">Existing action</button>; }
`;
const OLD = '"use client"; export function SidebarView() { return <div>Workspace</div>; }';
const imports =
  'import { ProtectedAction, useCompact } from "@/components/shell/sidebarCapability";';
const NEW = `"use client"; ${imports}
export function SidebarView() {
  const compact = useCompact();
  return <div data-compact={compact}><ProtectedAction /></div>;
}`;
const PROFILE = {
  version: 2,
  modules: [LEAF],
  styles: [],
  adapters: [MOUNT],
  capabilities: [
    {
      path: CAPABILITY,
      exports: [
        { name: "ProtectedAction", kind: "component" },
        { name: "useCompact", kind: "hook" },
      ],
      consumers: [LEAF],
    },
  ],
};

async function fixture(context, overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wd-functional-v2-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  function git(...args) {
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
      .toString("utf8")
      .trim();
  }
  async function commit(changes) {
    for (const [path, content] of Object.entries(changes)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "Fixture",
    );
    return git("rev-parse", "HEAD");
  }
  git("init", "-q");
  const baselineRevision = await commit({
    ...Object.fromEntries(selectBuildEntries("all").map(({ in: path }) => [path, "export {};"])),
    "package.json": '{"name":"fixture","dependencies":{"react":"19.3.1"}}',
    "bun.lock": '{"packages":{"react":["react@19.3.1"]}}',
    "next.config.ts": "export default {};",
    "tsconfig.json":
      '{"compilerOptions":{"paths":{"@/*":["./src/*"]},"moduleResolution":"bundler"}}',
    "src/app/globals.css": `@import "tailwindcss";\n${WEB_SOURCE_RULES.join("\n")}`,
    [MOUNT]:
      'import { SidebarView } from "./SidebarView"; export default function Page() { return <SidebarView />; }',
    [LEAF]: OLD,
    [CAPABILITY]: PROVIDER,
    ...overrides,
  });
  async function verify(changes, profile = PROFILE) {
    git("checkout", "--quiet", "--detach", baselineRevision);
    const currentRevision = await commit(changes);
    return verifyWebFunctionalSource({ root, baselineRevision, currentRevision, profile });
  }
  return verify;
}

void test("exact v2 profile admits a frozen native mount, boolean hook and prop-less component", async (context) => {
  const verify = await fixture(context);
  const result = await verify({ [LEAF]: NEW });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.kind, "warpdrive-web-functional-source");
  assert.equal(result.deploymentAuthorized, false);
  assert.match(result.capabilityBindingsSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    result.changed.map(({ path }) => path),
    [LEAF],
  );
  const changed = await verify({
    [LEAF]: NEW.replace("data-compact={compact}", "data-layout={compact}"),
  });
  assert.equal(result.capabilityBindingsSha256, changed.capabilityBindingsSha256);
  assert.equal(result.protectedSourceSha256, changed.protectedSourceSha256);
  const onlyComponent = await verify({
    [LEAF]: NEW.replace(", useCompact", "")
      .replace("const compact = useCompact();", "")
      .replace(" data-compact={compact}", ""),
  });
  assert.notEqual(result.capabilityBindingsSha256, onlyComponent.capabilityBindingsSha256);
});

void test("reviewed provider and authenticated mount remain exact immutable Git inputs", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({ [LEAF]: NEW, [CAPABILITY]: PROVIDER.replace("return true", "return false") }),
    /Protected source bytes changed/u,
  );
  await assert.rejects(
    verify({ [LEAF]: NEW, [MOUNT]: "export default function Page() { return null; }" }),
    /Protected source bytes changed/u,
  );
  const badProvider = await fixture(context, {
    [CAPABILITY]: PROVIDER.replace(": boolean", ": unknown"),
  });
  await assert.rejects(badProvider({ [LEAF]: NEW }), /capability export shape/u);
});

void test("capabilities cannot become indirect effects, event hooks or arbitrary SDK-like controls", async (context) => {
  const verify = await fixture(context);
  const cases = [
    [
      NEW.replace("const compact = useCompact();", "const compact = useCompact(42);"),
      /capability use/u,
    ],
    [NEW.replace("useCompact();", "useCompact?.();"), /capability use/u],
    [
      NEW.replace("const compact = useCompact();", "const compact = useCompact;"),
      /capability use/u,
    ],
    [
      NEW.replace("const compact = useCompact();", "const compact = {useCompact};"),
      /capability use/u,
    ],
    [
      NEW.replace("const compact = useCompact();", "const compact = () => useCompact();"),
      /capability use/u,
    ],
    [
      NEW.replace(
        "const compact = useCompact();",
        "if (true) return null; const compact = useCompact();",
      ),
      /capability use/u,
    ],
    [
      NEW.replace(
        "const compact = useCompact();",
        "const compact = useCompact(); const again = useCompact();",
      ),
      /capability use/u,
    ],
    [
      NEW.replace("<ProtectedAction />", '<ProtectedAction aria-label="Override" />'),
      /capability use/u,
    ],
    [
      NEW.replace("<ProtectedAction />", "<ProtectedAction>Override</ProtectedAction>"),
      /capability use/u,
    ],
    [
      NEW.replace(
        "<ProtectedAction />",
        '<button type="button" onClick={() => ProtectedAction()}>Run</button>',
      ),
      /capability use/u,
    ],
    [
      NEW.replace("useCompact }", "useCompact as alias }").replace("useCompact();", "alias();"),
      /unaliased/u,
    ],
    [`${NEW}export function Other() { return SidebarView(); }`, /terminal mount/u],
    [`${NEW}export function Unsafe() { return fetch("/api"); }`, /Unreviewed presentation call/u],
    [
      NEW.replace("<ProtectedAction />", "<ProtectedAction />{window.location}"),
      /Unreviewed presentation property|unbound presentation identifier/u,
    ],
    [
      `${NEW}export const escape = import("@/components/shell/sidebarCapability");`,
      /exact static import/u,
    ],
    [
      NEW.replace(
        "const compact = useCompact();",
        "const before = setSomeState(); const compact = useCompact();",
      ),
      /effect before/u,
    ],
    [
      `${NEW.replace("<ProtectedAction />", "<Wrapper><ProtectedAction /></Wrapper>")}\nfunction Wrapper() { return null; }`,
      /capability use/u,
    ],
    [NEW.replace("return <div", "if (compact) return null; return <div"), /capability use/u],
  ];
  for (const [source, error] of cases) {
    await assert.rejects(verify({ [LEAF]: source }), error);
  }
});

void test("type-only or unlisted names and unrelated consumers cannot use a capability", async (context) => {
  const verify = await fixture(context);
  await assert.rejects(
    verify({
      [LEAF]: NEW.replace("useCompact }", "type useCompact }"),
    }),
    /unaliased/u,
  );
  await assert.rejects(
    verify({
      [LEAF]: NEW.replace("useCompact", "useOther"),
    }),
    /unaliased/u,
  );
  const withoutGrant = { ...PROFILE, capabilities: [] };
  await assert.rejects(verify({ [LEAF]: NEW }, withoutGrant), /Unreviewed presentation import/u);
});

void test("transitive protected roots and mutable intermediate render paths cannot reach the island", async (context) => {
  const api = "src/app/api/example/route.ts";
  const verify = await fixture(context, {
    [api]: 'export { default as GET } from "../../(app)/[workspace]/page";',
  });
  await assert.rejects(verify({ [LEAF]: NEW }), /Protected server, route or runtime closure/u);
  const intermediary = "src/app/(app)/[workspace]/Wrapper.tsx";
  const second = await fixture(context, {
    [MOUNT]:
      'import { Wrapper } from "./Wrapper"; export default function Page() { return <Wrapper />; }',
    [intermediary]:
      '"use client"; import { SidebarView } from "./SidebarView"; export function Wrapper() { return <SidebarView />; }',
  });
  await assert.rejects(
    second({ [LEAF]: NEW }, { ...PROFILE, modules: [LEAF, intermediary] }),
    /exact immutable mount/u,
  );
});

void test("v2 path roles and grant budgets reject metadata, server, overlapping and undeclared inputs", () => {
  function reject(message) {
    throw new Error(message);
  }
  assert.deepEqual(readCapabilityProfile(PROFILE, reject), PROFILE);
  for (const profile of [
    { ...PROFILE, modules: ["src/app/(app)/[workspace]/page.tsx"] },
    { ...PROFILE, modules: ["src/app/(app)/(auth)/Widget.tsx"] },
    { ...PROFILE, modules: ["src/app/(app)/(.)api/Widget.tsx"] },
    { ...PROFILE, adapters: ["src/app/(app)/[workspace]/twitter-image2.tsx"] },
    {
      ...PROFILE,
      capabilities: [{ ...PROFILE.capabilities[0], consumers: ["src/components/shell/Other.tsx"] }],
    },
    {
      ...PROFILE,
      capabilities: [
        { ...PROFILE.capabilities[0], path: "src/app/(app)/[workspace]/Capability.tsx" },
      ],
    },
    {
      ...PROFILE,
      capabilities: [
        { ...PROFILE.capabilities[0], exports: [...PROFILE.capabilities[0].exports].reverse() },
      ],
    },
    { ...PROFILE, modules: [...PROFILE.modules, LEAF] },
  ]) {
    assert.throws(
      () => readCapabilityProfile(profile, reject),
      /functional Web|Capability consumers/u,
    );
  }
});

import { readFileSync } from "node:fs";
import dockerignore from "@balena/dockerignore";
import { expect, test } from "vitest";

const read = (path: string): Buffer => readFileSync(new URL(`../${path}`, import.meta.url));
const context = () => dockerignore().add(read(".dockerignore").toString("utf8"));

test("Docker context omits private runtime fixtures at every depth while retaining build inputs", () => {
  // Synthetic paths exercise Docker matching, without reading private profile contents.
  const privateFiles = [
    ".runtime/sales.env",
    ".runtime/native-fixture.json",
    ".runtime/sales-postgres/base/123",
    ".runtime/sales-fixture.dump",
    "work/review/.runtime/sales.env",
    "packages/demo/.runtime/postgres/PG_VERSION",
  ];
  const requiredInputs = [
    ".env.example",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "patches/next@16.4.3.patch",
    "src/config/env.ts",
    "LICENSE",
    "third-party/xyflow-LICENSE.md",
    "public/licenses/Inter-OFL.txt",
  ];
  expect(context().filter([...privateFiles, ...requiredInputs])).toEqual(requiredInputs);
  for (const path of requiredInputs) expect(read(path).length).toBeGreaterThan(0);
});

test("runtime COPY contract includes retained application, component and font notices", () => {
  const runtime = read("Dockerfile")
    .toString("utf8")
    .split(/^FROM \S+ AS runtime\s*$/m)[1];
  expect(
    runtime,
    "An explicit runtime stage must remain available for notice inspection",
  ).toBeDefined();
  if (runtime === undefined) return;
  // Bounded inspection of this Dockerfile's plain COPY form, not an image build or general parser.
  const copies = runtime
    .split("\n")
    .filter((line) => line.startsWith("COPY ") && !line.includes("--from="))
    .map((line) => line.trim().split(/\s+/).slice(1));
  expect(copies).toEqual(
    expect.arrayContaining([
      ["LICENSE", "./LICENSE"],
      ["third-party", "./third-party"],
    ]),
  );
  expect(
    context().filter(["LICENSE", "third-party/shadcn-LICENSE.md", "third-party/xyflow-LICENSE.md"]),
  ).toEqual(["LICENSE", "third-party/shadcn-LICENSE.md", "third-party/xyflow-LICENSE.md"]);
  expect(read("third-party/shadcn-LICENSE.md")).toEqual(read("docs/third-party/shadcn-LICENSE.md"));
  expect(runtime).toMatch(/^COPY --from=build \/app\/public \.\/public\s*$/m);
  for (const [shipped, original] of [
    ["Inter-OFL.txt", "inter/OFL.txt"],
    ["Vazirmatn-OFL.txt", "vazirmatn/OFL.txt"],
    ["Vazirmatn-AUTHORS.txt", "vazirmatn/AUTHORS.txt"],
  ]) {
    expect(context().ignores(`public/licenses/${shipped}`)).toBe(false);
    expect(read(`public/licenses/${shipped}`)).toEqual(read(`docs/third-party/${original}`));
  }
});

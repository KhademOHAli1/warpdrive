import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { auditSource } from "./auditSource";

describe("localization source inventory", () => {
  it("does not classify TypeScript generic functions as JSX interface copy", () => {
    expect(
      auditSource(
        "export const transaction = <R>(callback: () => Promise<R>) => callback();",
        "src/adapter.ts",
      ),
    ).toEqual([]);
  });
  it("includes custom accessibility role descriptions as user-facing copy", () => {
    expect(
      auditSource('<button aria-roledescription="draggable card" />', "src/Card.tsx").map(
        (f) => f.text,
      ),
    ).toEqual(["draggable card"]);
  });
  it("finds visible copy and accessible labels without treating code or styling as copy", () => {
    const source = `import {STRINGS as S} from "@/constants/strings";
      export const View = () => <button className="text-left" aria-label="Close dialog">Save changes</button>;`;
    const findings = auditSource(source, "src/View.tsx");
    expect(findings.map((finding) => [finding.kind, finding.text])).toEqual([
      ["legacy-catalog", "@/constants/strings"],
      ["literal", "Close dialog"],
      ["literal", "Save changes"],
    ]);
  });

  it("finds conditional and interpolated text and retains an actionable source location", () => {
    const findings = auditSource(
      `export const View = () => <p>{busy ? "Saving…" : \`Saved \${count} items\`}</p>;`,
      "src/View.tsx",
    );
    expect(findings.map((finding) => finding.text)).toEqual(["Saving…", "Saved {…} items"]);
    expect(findings.every((finding) => finding.line === 1)).toBe(true);
  });

  it("ignores message keys, identifiers, URLs and empty presentational content", () => {
    expect(
      auditSource(
        `export const View = () => <a href="/settings" data-testid="settings">{t("settings.title")}</a>;`,
        "src/View.tsx",
      ),
    ).toEqual([]);
  });

  it("does not confuse a machine-state comparison with visible copy", () => {
    const findings = auditSource(
      `export const View = () => <p>{status === "active" && "Enabled"}</p>;`,
      "src/View.tsx",
    );
    expect(findings.map((finding) => finding.text)).toEqual(["Enabled"]);
  });

  it("does not count compile-only legacy shape imports as untranslated runtime copy", () => {
    expect(
      auditSource(
        `import type {STRINGS} from "@/constants/strings"; import {type SETTINGS_STRINGS} from "@/constants/settingsStrings";`,
        "src/types.ts",
      ),
    ).toEqual([]);
  });

  it("distinguishes localized message factories from the legacy English constants", () => {
    expect(
      auditSource(
        `import {createSalesStrings} from "@/features/deals/salesStrings"; import {useActivitiesStrings} from "./useActivitiesStrings";`,
        "src/View.tsx",
      ),
    ).toEqual([]);
    expect(
      auditSource(
        `import {ACTIVITY_STRINGS} from "../../constants/activityStrings";`,
        "src/View.tsx",
      ),
    ).toHaveLength(1);
  });
});

describe("bounded computed-copy inventory", () => {
  const texts = (source: string) =>
    auditSource(source, "src/Computed.tsx").map((item) => item.text);

  it("finds indexed visible const-map values through aliases and type wrappers once per origin", () => {
    const source = `
      const REASONS = ({email: "Already has this email", phone: "Already has this phone"} as const)
        satisfies Record<string, string>;
      const copy = REASONS;
      function View({reason}: {reason: string}) { return <><p>{copy[reason]}</p><span>{copy[reason]}</span></>; }
    `;
    expect(texts(source)).toEqual(["Already has this email", "Already has this phone"]);
    expect(auditSource(source, "src/Computed.tsx").every((item) => item.line === 2)).toBe(true);
  });

  it("resolves own properties and literal keys without reporting unrelated map entries", () => {
    expect(
      texts(`const COPY={email:"Email found", phone:"Phone found"};
      const View=()=> <><p>{COPY.email}</p><span>{COPY["email"]}</span></>;`),
    ).toEqual(["Email found"]);
    expect(
      texts(`const COPY={email:"Email found"}; const View=()=> <p>{COPY["constructor"]}</p>;`),
    ).toEqual([]);
  });

  it("finds templates assigned to rendered verified React state at their setter location", () => {
    const source = `import {useState as useLocalState} from "react";
      function View({missing}) {
        const [error,setError]=useLocalState<string|null>(null);
        function save(){setError(\`\${missing.name} is required\`);}
        return <p>{error}</p>;
      }`;
    expect(texts(source)).toEqual(["{…} is required"]);
    expect(auditSource(source, "src/Computed.tsx")[0]?.line).toBe(4);
  });

  it("recognizes namespace React state and follows only updater return values", () => {
    expect(
      texts(`import * as React from "react";
      function View(){ const [error,setError]=React.useState(null);
        setError(previous=>{ log("Debug only"); return previous ?? "Save failed"; });
        return <p>{error}</p>; }`),
    ).toEqual(["Save failed"]);
  });

  it("does not attribute a shadowed const-map parameter to an outer declaration", () => {
    expect(
      texts(`const COPY={message:"Outer copy"};
      function View(COPY){return <p>{COPY.message}</p>;}`),
    ).toEqual([]);
  });

  it("keeps setters with the same spelling in separate lexical scopes", () => {
    expect(
      texts(`import {useState} from "react";
      function View(){const [error,setError]=useState(null);
        function run(setError){setError("Not the React setter");}
        setError("Visible failure"); return <p>{error}</p>;}`),
    ).toEqual(["Visible failure"]);
  });

  it("ignores unrendered state, non-React hooks, and shadowed hook parameters", () => {
    expect(
      texts(`import {useState} from "other-state";
      function View(){const [error,setError]=useState(null);setError("Not verified");return <p>{error}</p>;}`),
    ).toEqual([]);
    expect(
      texts(`import {useState} from "react";
      function View(useState){const [error,setError]=useState(null);setError("Not React");return <p>{error}</p>;}`),
    ).toEqual([]);
    expect(
      texts(`import {useState} from "react";
      function View(){const [error,setError]=useState(null);setError("Unrendered");return <p>{t("title")}</p>;}`),
    ).toEqual([]);
  });

  it("keeps translated calls, helpers, logs, class names, URLs and machine values opaque", () => {
    expect(
      texts(`import {useState} from "react";
      const KEYS={email:"messages.email"};
      const CLASSES={primary:"text-left"};
      function View(){const [error,setError]=useState(null);setError(t("errors.required"));
        log("Debug text"); return <a className={CLASSES.primary} href="/settings">{t(KEYS.email)}{error}{helper("Helper argument")}</a>;}`),
    ).toEqual([]);
  });

  it("terminates cyclic const/state references while retaining reachable copy", () => {
    expect(texts(`const A=B;const B=A;const View=()=> <p>{A}</p>;`)).toEqual([]);
    expect(
      texts(`import {useState} from "react";
      function View(){const [error,setError]=useState(null);const copy=error;
        setError(copy || "Fallback failure");return <p>{copy}</p>;}`),
    ).toEqual(["Fallback failure"]);
  });

  it("fails visibly when the bounded resolver reaches its analysis limit", () => {
    const aliases = [
      'const copy0="Deep copy";',
      ...Array.from({ length: 80 }, (_, index) => `const copy${index + 1}=copy${index};`),
    ].join("\n");
    expect(() => texts(`${aliases}\nconst View=()=> <p>{copy80}</p>;`)).toThrow(/analysis limit/i);
  });
});

it("preserves previous literal IDs when new binding findings have identical text", () => {
  const original = auditSource("<button>Save</button>", "src/Stable.tsx")[0]?.id;
  const findings = auditSource(
    'const COPY="Save";\nconst View=()=> <>\n<button>Save</button><p>{COPY}</p></>;',
    "src/Stable.tsx",
  );
  expect(findings.find((item) => item.line === 3)?.id).toBe(original);
  expect(findings.filter((item) => item.text === "Save")).toHaveLength(2);
});

it("resolves const index aliases without reporting unreachable map entries", () => {
  const source = `const COPY={email:"Email found",phone:"Not selected"};const KEY="email" as const;
    const ALIAS=KEY; const View=()=> <p>{COPY[ALIAS]}</p>;`;
  expect(auditSource(source, "src/Key.tsx").map((item) => item.text)).toEqual(["Email found"]);
});

it("does not infer React setter dataflow from reassignable state bindings", () => {
  const source = `import {useState} from "react";
    function View(){let [error,setError]=useState(null);setError=log;
      setError("Log only");return <p>{error}</p>;}`;
  expect(auditSource(source, "src/Mutable.tsx")).toEqual([]);
});

it("binds local copy without consulting the filesystem or imported modules", () => {
  const spies = [
    vi.spyOn(ts.sys, "readFile"),
    vi.spyOn(ts.sys, "fileExists"),
    vi.spyOn(ts.sys, "readDirectory"),
  ];
  try {
    const source = `import {useState} from "react"; import remote from "./unavailable";
      function View(){const [error,setError]=useState(null);setError("Save failed");
        return <p>{error}{remote.message}</p>;}`;
    expect(auditSource(source, "src/NoIo.tsx").map((item) => item.text)).toEqual(["Save failed"]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { inspectWebSdkImports } from "./web_sdk_imports.mjs";

const SWITCH = "src/components/ui/Switch.tsx";
const PILOT = "src/components/shell/KeyboardHelp.tsx";
const sdkSwitch = "@ui-sdk/react/switch";
const client = '"use client";';
const admissionError = /Unreviewed Web SDK import/u;

function inspect(source, { path = SWITCH, version = 2 } = {}) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return inspectWebSdkImports(tree, path, version);
}

void test("the pinned Switch successor admits only the named public bindings in its reviewed file", () => {
  const source = `${client} import { Switch as SdkSwitch, SwitchThumb } from "${sdkSwitch}";`;
  assert.deepEqual(inspect(source), [
    { specifier: sdkSwitch, exported: "Switch", local: "SdkSwitch" },
    { specifier: sdkSwitch, exported: "SwitchThumb", local: "SwitchThumb" },
  ]);
  assert.throws(() => inspect(source, { version: 1 }), admissionError);
  assert.throws(() => inspect(source, { path: PILOT }), admissionError);
  assert.throws(() => inspect(source, { version: 3 }), /Unknown Web SDK import policy version/u);
});

void test("the pilot named component entries retain the same allowances in both policies", () => {
  const source = `${client}
    import { Menu, MenuTrigger } from "@ui-sdk/react/menu";
    import { Dialog, DialogContent } from "@ui-sdk/react/dialog";
    import { Drawer, DrawerTitle } from "@ui-sdk/react/drawer";`;
  const pilot = inspect(source, { path: PILOT, version: 1 });
  assert.deepEqual(
    pilot.map(({ exported }) => exported),
    ["Menu", "MenuTrigger", "Dialog", "DialogContent", "Drawer", "DrawerTitle"],
  );
  assert.deepEqual(inspect(source, { path: PILOT }), pilot);
  assert.deepEqual(inspect('import { cn } from "@/lib/utils";'), []);
});

void test("the successor rejects unreviewed symbols, forms, locations and aliases", () => {
  const invalidSources = [
    `import { Switch } from "${sdkSwitch}";`,
    `${client} import { createSwitchController as Switch } from "${sdkSwitch}";`,
    `${client} import { Switch } from "${sdkSwitch}/internal";`,
    `${client} import { Switch } from "@ui-sdk/core/switch";`,
    `${client} import { Switch } from "@ui-sdk/react";`,
    `${client} import DefaultSwitch, { Switch } from "${sdkSwitch}";`,
    `${client} import * as SDK from "${sdkSwitch}";`,
    `${client} import "${sdkSwitch}";`,
    `${client} import {} from "${sdkSwitch}";`,
    `${client} import type { Switch } from "${sdkSwitch}";`,
    `/// <reference types="${sdkSwitch}" />\n${client}`,
    `/// <reference path="./node_modules/${sdkSwitch}" />\n${client}`,
    `${client} import { type Switch } from "${sdkSwitch}";`,
    `${client} import { Switch } from "${sdkSwitch}" with { type: "json" };`,
    `${client} import { Switch as S, SwitchThumb as S } from "${sdkSwitch}";`,
    `${client} import { Switch as S, Switch as T } from "${sdkSwitch}";`,
    `${client} export { Switch } from "${sdkSwitch}";`,
    `${client} import { Switch } from "${sdkSwitch}"; export { Switch };`,
    `${client} import { Switch } from "${sdkSwitch}"; export default Switch;`,
    `${client} export * from "${sdkSwitch}";`,
    `${client} const sdk = import("${sdkSwitch}");`,
    `${client} const sdk = import(\`${sdkSwitch}\`);`,
    `${client} type T = import("${sdkSwitch}").Switch;`,
    `${client} import sdk = require("${sdkSwitch}");`,
    `${client} const sdk = require("${sdkSwitch}");`,
    `${client} import { Switch } from "%40ui-sdk%2freact%2fswitch";`,
    `${client} import { Switch } from "./node_modules/${sdkSwitch}";`,
    String.raw`"use client"; import { Switch } from "@ui-sdk/react/\u0073witch";`,
    String.raw`"use client"; import { \u0053witch } from "@ui-sdk/react/switch";`,
    `${client} import { Switch from "${sdkSwitch}";`,
  ];
  for (const source of invalidSources) {
    assert.throws(() => inspect(source), admissionError, source);
  }
});

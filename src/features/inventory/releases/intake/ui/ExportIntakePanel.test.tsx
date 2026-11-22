// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, assert, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { InventoryItem } from "../../../contracts";
import { inventoryFixture } from "../../../fixtures";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "../../ui/ManufacturingReleasesFixture";
import type {
  ExportIntakeAccess,
  ExportIntakeBinding,
  ExportIntakeJob,
  ExportManifest,
} from "../contracts";
import { ExportIntakePanel } from "./ExportIntakePanel";

const content = "(kicad_pcb (version 20261122))\n";
const name = "controller.kicad_pcb";
const digest = createHash("sha256").update(content).digest("hex");
const manifest: ExportManifest = {
  schemaVersion: 1,
  exporter: { name: "kicad", version: "10.0", sourceRevision: "fixture-c" },
  target: { sku: "IO-24-DIN", revision: "C" },
  files: [
    {
      name,
      kind: "pcbSource",
      sizeBytes: new TextEncoder().encode(content).byteLength,
      sha256: digest,
    },
  ],
};

function file(text: string, name: string) {
  const value = new File([text], name);
  Object.defineProperties(value, {
    text: { value: () => Promise.resolve(text) },
    arrayBuffer: { value: () => Promise.resolve(new TextEncoder().encode(text).buffer) },
  });
  return value;
}

function release(item: InventoryItem | null) {
  return (
    <LocaleProvider locale="en">
      <ManufacturingReleaseFixtureProvider canEditIntake>
        {item !== null && <ManufacturingReleasesFixture item={item} />}
      </ManufacturingReleaseFixtureProvider>
    </LocaleProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("validates exact manifests and files, then displays an immutable failed attempt and ready receipt on a newly created draft", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const product = inventoryFixture(undefined).items.find(({ sku }) => sku === manifest.target.sku);
  assert(product !== undefined);
  const view = render(release(product));
  expect(screen.queryByRole("button", { name: "Import exporter bundle" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Revision" }), { target: { value: "C" } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await screen.findByText("No exporter bundles have been imported for this release.");
  fireEvent.click(screen.getByRole("button", { name: "Import exporter bundle" }));

  const dialog = within(screen.getByRole("dialog", { name: "Import exporter bundle" }));
  expect(dialog.getByText(manifest.target.revision)).toBeVisible();
  const manifestInput = dialog.getByLabelText("Manifest file");
  const bundleInput = dialog.getByLabelText("Bundle files");
  const validate = () => fireEvent.click(dialog.getByRole("button", { name: "Validate bundle" }));
  const submit = dialog.getByRole("button", { name: "Submit import" });
  const uploadManifest = (value: ExportManifest) =>
    fireEvent.change(manifestInput, {
      target: { files: [file(JSON.stringify(value), "manifest.json")] },
    });

  uploadManifest({ ...manifest, target: { ...manifest.target, revision: "B" } });
  validate();
  await dialog.findByText("The manifest product or revision does not match this release.");
  expect(submit).toBeDisabled();
  uploadManifest(manifest);
  validate();
  expect(await dialog.findByText(/A file listed in the manifest is missing/)).toHaveAttribute(
    "data-export-intake-issue",
    "missingFile",
  );
  expect(submit).toBeDisabled();
  fireEvent.change(bundleInput, { target: { files: [file(content, name)] } });
  validate();
  await dialog.findByRole("heading", { name: "Verified bundle preview" });
  expect(dialog.getByText("PCB source", { exact: false })).toBeVisible();
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  const retry = await screen.findByRole("button", { name: "Retry failed attempt" });
  const failure = retry.getAttribute("data-export-intake-retry");
  const job = retry.closest("[data-export-intake-job]");
  assert(job !== null && failure !== null);
  expect(job).toHaveAttribute("data-export-intake-state", "failed");
  fireEvent.click(retry);
  const receipt = await screen.findByText(digest);
  const artifact = receipt.closest("[data-export-intake-artifact]");
  expect(artifact).toHaveAttribute("data-export-intake-artifact", name);
  expect(artifact).toHaveAttribute("data-export-intake-artifact-kind", "pcbSource");
  const ready = artifact?.closest("[data-export-intake-job]");
  expect(ready).toHaveAttribute("data-export-intake-state", "ready");
  expect(ready?.querySelector(`[data-export-intake-attempt='${failure}']`)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve release" })).toBeDisabled();

  view.rerender(release(null));
  view.rerender(release(product));
  fireEvent.click(screen.getByRole("button", { name: "Rev C" }));
  expect(await screen.findByText(digest)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Rev B" }));
  await screen.findByText("No exporter bundles have been imported for this release.");
  expect(screen.queryByText(digest)).not.toBeInTheDocument();
});

it("masks existing history during a focus recheck and discards a prior port's late response", async () => {
  const target: ExportIntakeBinding = { ...manifest.target, itemId: "part-c", releaseId: "rev-c" };
  const example: ExportIntakeJob = {
    id: "job-one",
    submittedAt: "2026-11-22T08:00:00Z",
    target,
    manifest,
    state: "ready",
    attempts: [],
    artifacts: [{ id: "artifact-one", kind: "pcbSource", sha256: digest, name }],
    failedAttemptId: null,
  };
  let finish: (result: Awaited<ReturnType<ExportIntakeAccess["list"]>>) => void = () => {};
  const pending = new Promise<Awaited<ReturnType<ExportIntakeAccess["list"]>>>((resolve) => {
    finish = resolve;
  });
  const read = vi
    .fn<ExportIntakeAccess["list"]>()
    .mockResolvedValueOnce({ ok: true, value: [example] })
    .mockResolvedValueOnce({ ok: true, value: [{ ...example }] })
    .mockReturnValueOnce(pending);
  const access: ExportIntakeAccess = { list: read, submit: vi.fn(), retry: vi.fn() };
  const denied: ExportIntakeAccess = {
    ...access,
    list: () => Promise.resolve({ ok: false, issues: [{ code: "unavailable" }] }),
  };
  const onReady = vi.fn();
  const show = (port: ExportIntakeAccess) => (
    <LocaleProvider locale="en">
      <ExportIntakePanel {...{ target, onReady }} canEdit access={port} />
    </LocaleProvider>
  );
  const view = render(show(access));
  expect(await screen.findByText(digest)).toBeVisible();
  expect(onReady).toHaveBeenCalledExactlyOnceWith(example);
  fireEvent.click(screen.getByRole("button", { name: "Refresh imports" }));
  expect(await screen.findByText(digest)).toBeVisible();
  expect(onReady).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event("focus"));
  expect(screen.queryByText(digest)).not.toBeInTheDocument();
  view.rerender(show(denied));
  expect(await screen.findByText("Bundle intake is unavailable for this release.")).toBeVisible();
  expect(read.mock.calls[2]?.[1]?.aborted).toBe(true);
  await act(async () => {
    finish({ ok: true, value: [example] });
    await pending;
  });
  expect(screen.queryByText(digest)).not.toBeInTheDocument();
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Import exporter bundle" })).not.toBeInTheDocument();
});

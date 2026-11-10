// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  detail,
  expectEligibilityUnverified,
  namedList,
  personLabel,
  previewPacket,
  previewRegion,
  projectId,
  renderPreview,
  rowFor,
  sharedIdentityId,
  staffLabel,
  unusedLabel,
} from "./TemplateInstallPreview.test-support";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retains full declared source order and template identity without claiming generated canonical records", () => {
  const packet = previewPacket();
  const before = structuredClone(packet);
  renderPreview(packet);
  expect(previewRegion()).toHaveTextContent("Model production");
  expect(previewRegion()).toHaveTextContent("Internal production plan");
  expect(previewRegion()).toHaveTextContent("modeling_project");
  expect(
    Array.from(namedList("Stages").children).map((row) => row.querySelector("h4")?.textContent),
  ).toEqual(["Briefing", "Production", "Approval"]);
  expect(
    Array.from(namedList("Deliverables").children).map(
      (row) => row.querySelector("h4")?.textContent,
    ),
  ).toEqual(["Model draft"]);
  expect(
    Array.from(namedList("Planned items").children).map(
      (row) => row.querySelector("h4")?.textContent,
    ),
  ).toEqual(["Review model", "Follow up briefing", "Model assignment"]);
  const rows = Array.from(namedList("Planned items").children);
  expect(rows.map((row) => row.querySelector("time")?.dateTime)).toEqual([
    "2027-03-23",
    "2027-03-20",
    "2027-03-21",
  ]);
  expectEligibilityUnverified();
  expect(packet).toEqual(before);
});

it("keeps own stages, ancestor deliverable stages, dependencies and responsible roles on their own source rows", () => {
  renderPreview();
  const review = rowFor(namedList("Planned items"), "Review model");
  expect(detail(review, "Kind")).toHaveTextContent("Review");
  expect(detail(review, "Stage")).toHaveTextContent("Approval");
  expect(detail(review, "Deliverable")).toHaveTextContent("Model draft");
  expect(detail(review, "Deliverable stage")).toHaveTextContent("Production");
  expect(detail(review, "Dependencies")).toHaveTextContent("Model assignment");
  expect(detail(review, "Source reference")).toHaveTextContent("model_review");
  expect(detail(review, "Responsible role")).toHaveTextContent("Internal producer");
  const followup = rowFor(namedList("Planned items"), "Follow up briefing");
  expect(detail(followup, "Kind")).toHaveTextContent("Follow-up");
  expect(detail(followup, "Stage")).toHaveTextContent("Briefing");
  expect(detail(followup, "Dependencies")).toHaveTextContent("None");
  const assignment = rowFor(namedList("Planned items"), "Model assignment");
  expect(detail(assignment, "Kind")).toHaveTextContent("Assignment");
  expect(detail(assignment, "Dependencies")).toHaveTextContent("Follow up briefing");
  expect(detail(assignment, "Internal producer role")).toHaveTextContent("Internal producer");
  expect(detail(assignment, "Freelancer role")).toHaveTextContent("Freelance modeler");
  const deliverable = rowFor(namedList("Deliverables"), "Model draft");
  expect(detail(deliverable, "Stage")).toHaveTextContent("Production");
  expect(detail(deliverable, "Responsible role")).toHaveTextContent("Internal producer");
  expect(detail(rowFor(namedList("Stages"), "Approval"), "Dependencies")).toHaveTextContent(
    "Production",
  );
});

it("shows every role including an unused role and keeps user versus contact identity tags separate for the same UUID", () => {
  renderPreview();
  const roles = namedList("Roles");
  expect(roles.children).toHaveLength(3);
  const employee = rowFor(roles, "Internal producer");
  expect(employee).toHaveTextContent("Internal user");
  expect(employee).toHaveTextContent(staffLabel);
  expect(employee).not.toHaveTextContent(personLabel);
  const contact = rowFor(roles, "Freelance modeler");
  expect(contact).toHaveTextContent("Freelancer contact");
  expect(contact).toHaveTextContent(personLabel);
  expect(contact).not.toHaveTextContent(staffLabel);
  const unused = rowFor(roles, "Unused internal role");
  expect(unused).toHaveTextContent(unusedLabel);
  expect(unused).toHaveTextContent("Unused in this template");
  expect(previewRegion()).not.toHaveTextContent(sharedIdentityId);
  expect(previewRegion()).not.toHaveTextContent(projectId);
  expectEligibilityUnverified();
});

it("shows unmapped roles without treating a syntactically valid empty selection as ready", () => {
  renderPreview(previewPacket({ bindings: [] }));
  expect(within(namedList("Roles")).getAllByText("Not mapped")).toHaveLength(3);
  expectEligibilityUnverified();
});

it("uses explicit kind-specific unavailable labels without exposing raw native IDs", () => {
  renderPreview(previewPacket({ userLabels: {}, personLabels: {} }));
  expect(within(namedList("Roles")).getAllByText("User unavailable")).toHaveLength(2);
  expect(within(namedList("Roles")).getByText("Contact unavailable")).toBeInTheDocument();
  expect(previewRegion()).not.toHaveTextContent(sharedIdentityId);
  expectEligibilityUnverified();
});

it("isolates all authored HTML and URL labels as plain text and blocks the complete preview from capture", () => {
  const authored = '<img src="https://example.invalid/private.png"> نسخه';
  const reference = "<script>alert('private')</script> https://example.invalid/reference";
  const remote = vi.fn();
  vi.stubGlobal("fetch", remote);
  const source = previewPacket();
  const packet = previewPacket({
    manifest: {
      ...source.manifest,
      label: { ...source.manifest.label, en: authored },
      description: { ...source.manifest.description, en: reference },
    },
    userLabels: { [sharedIdentityId]: authored },
  });
  renderPreview(packet);
  const region = previewRegion();
  for (const text of [authored, reference]) {
    for (const element of within(region).getAllByText(text))
      expect(element.closest("bdi")).not.toBeNull();
  }
  expect(region.querySelector("a, img, iframe, script")).toBeNull();
  expect(region).toHaveClass(BLOCK_CLASS, "ph-no-capture");
  expect(remote).not.toHaveBeenCalled();
});

it("gives multiple preview instances independent accessible heading identities", () => {
  renderPreview();
  renderPreview();
  const regions = screen.getAllByRole("region", { name: "Template contents preview" });
  expect(new Set(regions.map((region) => region.getAttribute("aria-labelledby"))).size).toBe(2);
  for (const region of regions) expect(region).toHaveAttribute("dir", "ltr");
});

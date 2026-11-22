import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ReleaseView } from "../liveContracts";
import { ReleaseApprovalHistory } from "./ReleasePackageContent";

it("uses stable approval timestamps during the build package's server render", () => {
  const release: ReleaseView = {
    id: "release",
    revision: "A",
    status: "released",
    createdAt: "2026-11-22T08:03:00.000Z",
    approvedAt: "2026-11-22T08:06:00.000Z",
    createdBy: { id: "creator", name: "Editor" },
    approvedBy: { id: "approver", name: "Approver" },
    artifacts: [],
    bom: [],
  };
  const html = renderToString(
    <LocaleProvider locale="en" timeZone="Europe/Berlin">
      <ReleaseApprovalHistory release={release} />
    </LocaleProvider>,
  );
  expect(html).toContain(`dateTime="${release.createdAt}">${release.createdAt}</time>`);
  expect(html).toContain(`dateTime="${release.approvedAt}">${release.approvedAt}</time>`);
});

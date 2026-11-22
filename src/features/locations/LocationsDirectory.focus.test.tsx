// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LocationsResult, LocationsWorkspace } from "./contracts";
import { locationsFixture } from "./fixtures";
import { LocationsDirectory } from "./LocationsDirectory";

const bin = "34022ee2-32f1-426d-9c4d-ff3d78493610";
const toolCrib = "49db4044-941b-4760-8c7b-e91a49454faf";
const directory: LocationsWorkspace = {
  directory: {
    ...locationsFixture,
    sites: locationsFixture.sites.map((site) =>
      site.code === "FIELD" ? { ...site, archived: true } : site,
    ),
  },
  canManageSites: false,
  managedSiteIds: [],
  eligibleUsers: [],
  grants: [],
};

const submit = (): Promise<LocationsResult> => Promise.resolve({ ok: false, error: "unavailable" });

it("focuses an exact route in an archived site, then follows a second route without resetting later filters", () => {
  const { rerender } = render(
    <LocationsDirectory initial={directory} initialLocationId={toolCrib} submit={submit} fixture />,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Location details · Tool crib" }),
  );

  rerender(
    <LocationsDirectory initial={directory} initialLocationId={bin} submit={submit} fixture />,
  );
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Location details · Bin A-01" }),
  );

  const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search locations" });
  fireEvent.change(search, { target: { value: "Receiving" } });
  rerender(<LocationsDirectory initial={directory} submit={submit} fixture />);
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search locations" }).value).toBe(
    "Receiving",
  );
});

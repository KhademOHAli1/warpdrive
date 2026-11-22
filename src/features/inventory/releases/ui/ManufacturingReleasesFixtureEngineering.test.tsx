// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { assert, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { inventoryFixture } from "../../fixtures";
import type { EngineeringChangeAccess } from "../changes/contracts";
import type { EngineeringFixtureActor } from "../changes/fixture";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "./ManufacturingReleasesFixture";

const observe = vi.hoisted(() => vi.fn<(access: EngineeringChangeAccess) => void>());
vi.mock("../changes/ui/EngineeringChangePanel", () => ({
  EngineeringChangePanel({ access }: { access: EngineeringChangeAccess }) {
    observe(access);
    return null;
  },
}));

it("keeps an open engineering session stable through equivalent route props and refreshes real scope changes", () => {
  const item = inventoryFixture(undefined).items.find(({ sku }) => sku === "IO-24-DIN");
  assert(item !== undefined);
  const actor: EngineeringFixtureActor = {
    id: "editor",
    name: "Editor",
    canView: true,
    canPropose: true,
    canDecide: true,
    visibleSites: ["berlin", "dresden"],
    dispositionSites: ["berlin"],
  };
  const view = (value: EngineeringFixtureActor) => (
    <LocaleProvider locale="en">
      <ManufacturingReleaseFixtureProvider engineeringActor={value}>
        <ManufacturingReleasesFixture item={item} />
      </ManufacturingReleaseFixtureProvider>
    </LocaleProvider>
  );
  const rendered = render(view(actor));
  const original = observe.mock.lastCall?.[0];
  assert(original !== undefined);
  rendered.rerender(
    view({ ...actor, visibleSites: ["dresden", "berlin"], dispositionSites: ["berlin"] }),
  );
  expect(observe.mock.lastCall?.[0]).toBe(original);
  rendered.rerender(view({ ...actor, dispositionSites: [] }));
  expect(observe.mock.lastCall?.[0]).not.toBe(original);
});

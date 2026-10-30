// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/contacts/people/person-1" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ContactsNav } from "./ContactsNav";

afterEach(cleanup);

describe("ContactsNav", () => {
  it("keeps section links and their active state while opening a record", () => {
    render(<ContactsNav />);

    for (const label of ["People", "Organizations", "Timeline"]) {
      expect(screen.getByRole("link", { name: label }).querySelector("svg")).not.toBeNull();
    }

    const active = screen.getByRole("link", { name: "People" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("border-primary", "font-semibold", "text-primary");

    const idle = screen.getByRole("link", { name: "Organizations" });
    expect(idle).toHaveClass("border-transparent", "text-muted-foreground");
  });

  it("uses a scrollable horizontal switcher without taking table width", () => {
    render(<ContactsNav />);
    expect(screen.getByRole("navigation", { name: "Contacts sections" })).toHaveClass(
      "overflow-x-auto",
    );
    expect(screen.getByRole("list")).toHaveClass("flex", "min-w-max");
  });
});

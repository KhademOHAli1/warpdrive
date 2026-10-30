// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SectionHeading } from "./SectionHeading";

afterEach(cleanup);
it("does not suggest that an always-visible section can be collapsed", () => {
  render(<SectionHeading>History</SectionHeading>);
  const heading = screen.getByRole("heading", { name: "History" });
  expect(heading.querySelector("svg")).toBeNull();
  expect(heading.querySelector("button")).toBeNull();
});

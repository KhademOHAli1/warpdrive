// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SearchTrigger } from "./SearchTrigger";

afterEach(cleanup);

it("keeps the header search prompt concise", () => {
  render(<SearchTrigger />);
  expect(screen.getByRole("button", { name: "Open search" })).toHaveTextContent(
    "Search your workspace…",
  );
});

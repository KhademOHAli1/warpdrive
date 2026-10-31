// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { INTEGRATIONS } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";

afterEach(cleanup);

it.each(["chatgpt", "claude", "gmail", "slack", "google-calendar", "microsoft365", "zoom"])(
  "renders a local, decorative provider logo instead of an initial for %s",
  (id) => {
    const integration = INTEGRATIONS.find((item) => item.id === id);
    expect(integration).toBeDefined();
    if (!integration) return;
    const { container } = render(<IntegrationMark integration={integration} />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", `/integrations/${id}.svg`);
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("width", "24");
    expect(container.textContent).toBe("");
  },
);

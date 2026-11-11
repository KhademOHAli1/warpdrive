import { expect, it } from "vitest";
import {
  readVisualBlocks,
  renderVisualBlocks,
  serializeVisualBlocks,
  type VisualBlock,
} from "./blocks";

const sample: VisualBlock = {
  id: "1c2cb2ba-7d0c-48e0-936a-54cb3626be58",
  type: "heading",
  text: "<script> {{ .Subscriber.Email }}",
  url: "",
};

it("retains native layout and preserves imported editor sources", () => {
  expect(readVisualBlocks(serializeVisualBlocks([sample]), "<p>Existing</p>")).toEqual([sample]);
  expect(readVisualBlocks("", "")).toEqual([]);
  expect(readVisualBlocks('{"components":[]}', "<p>Imported</p>")).toBeNull();
  expect(
    readVisualBlocks(serializeVisualBlocks([sample, sample]), "<p>Duplicate IDs</p>"),
  ).toBeNull();
});

it("escapes authored HTML and template directives while preserving unsubscribe", () => {
  const html = renderVisualBlocks(
    [
      sample,
      {
        ...sample,
        id: "21769c7b-8064-44ab-87cd-a490f2fd6698",
        type: "button",
        url: "javascript:alert(1)",
      },
      {
        ...sample,
        id: "18e11830-45b6-4af7-97c9-53ccf617cc89",
        type: "image",
        url: "https://example.test/a?x=1&y=2",
      },
    ],
    "Unsubscribe",
  );
  expect(html).toContain("&lt;script&gt; &#123;&#123; .Subscriber.Email &#125;&#125;");
  expect(html).toContain("https://example.test/a?x=1&amp;y=2");
  expect(html).toContain('href="{{ UnsubscribeURL }}"');
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("{{ .Subscriber.Email }}");
});

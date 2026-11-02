import { describe, expect, it } from "vitest";
import { applyMergeFields } from "./merge";

describe("applyMergeFields", () => {
  it("substitutes known fields", () => {
    expect(applyMergeFields("Hi {{person.name}}", { "person.name": "Jane" })).toBe("Hi Jane");
  });
  it("blanks unknown fields", () => {
    expect(applyMergeFields("Hi {{person.unknown}}!", {})).toBe("Hi !");
  });

  it("substitutes a token the editor autolinked into an anchor", () => {
    const body = '<p>at {{<a href="http://org.name">org.name</a>}}</p>';
    expect(applyMergeFields(body, { "org.name": "Acme" })).toBe("<p>at Acme</p>");
  });

  it("blanks an autolinked token with no value rather than leaking the markup", () => {
    const body = '<p>at {{<a href="http://org.name">org.name</a>}}</p>';
    expect(applyMergeFields(body, {})).toBe("<p>at </p>");
  });

  it("substitutes a token split across formatting marks", () => {
    expect(applyMergeFields("Hi {{person.<em>name</em>}}", { "person.name": "Jane" })).toBe(
      "Hi Jane",
    );
  });

  it("substitutes a token padded with a non-breaking space", () => {
    expect(applyMergeFields("Hi {{\u00a0person.name\u00a0}}", { "person.name": "Jane" })).toBe(
      "Hi Jane",
    );
    expect(applyMergeFields("Hi {{&#160;person.name&nbsp;}}", { "person.name": "Jane" })).toBe(
      "Hi Jane",
    );
  });

  it("handles balanced nested formatting and quoted greater-than signs", () => {
    expect(
      applyMergeFields('{{person.<span title="a > b"><em>name</em></span>}}', {
        "person.name": "Jane",
      }),
    ).toBe("Jane");
  });

  it("does not resolve inherited object keys", () => {
    expect(applyMergeFields("{{constructor}}/{{toString}}/{{__proto__}}", {})).toBe("//");
    expect(applyMergeFields("{{constructor}}", {}, { keepUnresolved: true })).toBe(
      "{{constructor}}",
    );
    expect(applyMergeFields("{{constructor}}", { constructor: "own value" })).toBe("own value");
  });

  it.each([
    "{{person.<em>name}}",
    "{{person.<em>name</strong>}}",
    "{{person.<em><strong>name</em></strong>}}",
    '{{person.<em title="unterminated>name</em>}}',
    "{{person.< 3 >name}}",
    "{{person.<script>name</script>}}",
  ])("leaves a malformed or non-formatting token untouched: %s", (template) => {
    expect(applyMergeFields(template, { "person.name": "Jane" })).toBe(template);
  });

  it("keeps an unresolved token when the caller asks, so the send path can still resolve it", () => {
    expect(
      applyMergeFields(
        "Hi {{person.first_name}} at {{org.name}}",
        { "org.name": "Acme" },
        {
          keepUnresolved: true,
        },
      ),
    ).toBe("Hi {{person.first_name}} at Acme");
  });

  it("leaves a non-token brace pair alone", () => {
    expect(applyMergeFields("{{ not a token }}", { "person.name": "Jane" })).toBe(
      "{{ not a token }}",
    );
  });
});

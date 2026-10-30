import { expect, it } from "vitest";
import { conversationOrder } from "./conversationOrder";

it("places the latest message after earlier messages without mutating the server order", () => {
  const messages = [{ id: "latest" }, { id: "middle" }, { id: "first" }];
  expect(conversationOrder(messages)).toEqual({
    earlier: [{ id: "first" }, { id: "middle" }],
    latest: { id: "latest" },
  });
  expect(messages.map((m) => m.id)).toEqual(["latest", "middle", "first"]);
});
it("handles an empty conversation", () => {
  expect(conversationOrder([])).toEqual({ earlier: [], latest: undefined });
});

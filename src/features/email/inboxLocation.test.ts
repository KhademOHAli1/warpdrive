import { describe, expect, it } from "vitest";
import { inboxHref, readInboxLocation } from "./inboxLocation";

const id = "686c84c4-2eb5-4241-a116-b490ddadc1a7";
describe("inbox navigation state", () => {
  it("round trips the folder, search, filters and explicitly selected conversation", () => {
    const state = readInboxLocation(
      new URLSearchParams(
        `folder=sent&q=budget&view=unread&thread=${id}&filter=private&label=important`,
      ),
    );
    expect(state.threadId).toBe(id);
    expect(state.query).toBe("budget");
    expect(state.folder).toBe("sent");
    expect(state.view).toBe("unread");
    expect(state.attributes.label).toBe("important");
    expect(readInboxLocation(new URL(inboxHref(state), "http://localhost").searchParams)).toEqual(
      state,
    );
  });
  it("rejects invalid views, folders and conversation IDs without selecting a message", () => {
    const state = readInboxLocation(
      new URLSearchParams("folder=elsewhere&view=needs_reply&thread=not-an-id&filter=unknown"),
    );
    expect(state.folder).toBe("inbox");
    expect(state.view).toBe("all");
    expect(state.filter).toBe("all");
    expect(state.threadId).toBeNull();
  });
  it("does not confuse unread mail with waiting for a reply", () => {
    expect(readInboxLocation(new URLSearchParams("view=waiting")).view).toBe("waiting");
    expect(readInboxLocation(new URLSearchParams()).threadId).toBeNull();
  });
});

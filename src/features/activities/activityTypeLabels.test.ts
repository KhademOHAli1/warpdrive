import { describe, expect, it } from "vitest";
import { activityTypeName, localizeActivityTypes } from "./activityTypeLabels";

describe("activity type display names", () => {
  it("localizes all seeded defaults without changing identifiers or original rows", () => {
    const types = [
      { id: "a", key: "call", name: "Call", isSystem: true },
      { id: "b", key: "meeting", name: "Meeting" },
      { id: "c", key: "task", name: "Task" },
      { id: "d", key: "deadline", name: "Deadline" },
      { id: "e", key: "email", name: "Email" },
      { id: "f", key: "lunch", name: "Lunch" },
    ];
    const fa = localizeActivityTypes(types, "fa");
    expect(fa.map((t) => t.name)).toEqual(["تماس", "جلسه", "کار", "مهلت", "ایمیل", "ناهار"]);
    expect(fa.map((t) => t.id)).toEqual(types.map((t) => t.id));
    expect(types[0]?.name).toBe("Call");
    expect(localizeActivityTypes(types, "en")).toEqual(types);
  });
  it("preserves administrator edits and custom types even when names resemble defaults", () => {
    expect(activityTypeName({ key: "call", name: "تماس پشتیبانی", isSystem: true }, "fa")).toBe(
      "تماس پشتیبانی",
    );
    expect(activityTypeName({ key: "call", name: "Call", isSystem: false }, "fa")).toBe("Call");
    expect(activityTypeName({ key: "demo", name: "Meeting", isSystem: false }, "fa")).toBe(
      "Meeting",
    );
  });
});

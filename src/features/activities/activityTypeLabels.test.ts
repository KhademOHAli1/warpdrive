import { describe, expect, it } from "vitest";
import { activityTypeName, localizeActivityTypes } from "./activityTypeLabels";

describe("activity type display names", () => {
  it("uses German system defaults while preserving custom names and source records", () => {
    const types = [
      { key: "call", name: "Call", isSystem: true },
      { key: "meeting", name: "Meeting" },
      { key: "task", name: "Task" },
      { key: "deadline", name: "Deadline" },
      { key: "email", name: "Email" },
      { key: "lunch", name: "Lunch" },
    ];
    expect(localizeActivityTypes(types, "de").map((type) => type.name)).toEqual([
      "Anruf",
      "Besprechung",
      "Aufgabe",
      "Frist",
      "E-Mail",
      "Mittagessen",
    ]);
    expect(types[0]?.name).toBe("Call");
    expect(activityTypeName({ key: "call", name: "Kundengespräch", isSystem: true }, "de")).toBe(
      "Kundengespräch",
    );
    expect(activityTypeName({ key: "call", name: "Call", isSystem: false }, "de")).toBe("Call");
    expect(activityTypeName({ key: "__proto__", name: "Eigener Typ" }, "de")).toBe("Eigener Typ");
  });
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

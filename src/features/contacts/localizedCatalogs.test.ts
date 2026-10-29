import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { convertErrorMessage } from "@/features/leads/inbox/convertErrorMessage";
import { leadsEmptyState } from "@/features/leads/inbox/leadsEmptyState";
import { personFilterLabels } from "./contactFilterRows";
import { orgColumns } from "./orgColumns";
import { peopleColumns } from "./peopleColumns";

describe("localized contact and lead catalogs", () => {
  it("keeps storage and column identifiers while translating display labels", () => {
    expect(peopleColumns("fa").map((c) => c.key)).toEqual(peopleColumns("en").map((c) => c.key));
    expect(peopleColumns("fa")[0]?.header).toBe("نام");
    expect(orgColumns("fa").find((c) => c.key === "address")?.header).toBe("نشانی");
    expect(personFilterLabels("fa").ownerId).toBe("مسئول");
  });
  it("uses Persian explanations for lead state and permission failures", () => {
    expect(leadsEmptyState({ archived: false, hasFilter: true }, "fa").title).toBe(
      "سرنخی مطابق این فیلترها پیدا نشد",
    );
    expect(convertErrorMessage(ERROR_IDS.PERM_DENIED, "fa")).toBe(
      "شما اجازه ایجاد فرصت فروش ندارید.",
    );
  });
});

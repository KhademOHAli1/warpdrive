import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { type ContactActor, createPerson, updatePerson } from "@/features/contacts/personsRepo";
import { personCreateInput, personUpdateInput } from "@/features/contacts/schemas";
import { createDef } from "./defsRepo";

it("persists authored Persian and Arabic custom phone values through real create and update validation", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor: ContactActor = {
      id: user.id,
      type: "regular",
      isActive: true,
      groupIds: new Set(),
      flags: new Set(["contact.edit_own"]),
      primaryVisibilityGroupId: null,
    };
    const signal = new AbortController().signal;
    const field = await createDef(
      db,
      { targetEntity: "person", type: "phone", name: "Callback phone", isRequired: true },
      signal,
    );
    expect(field.ok).toBe(true);
    if (!field.ok) throw field.error;
    const first = "+۹۹ (۱۲۳) ۴۵۶-۷۸۹۰";
    const input = personCreateInput.parse({
      name: "مخاطب آزمایشی",
      customFields: { callback_phone: first },
    });
    const created = await createPerson(db, actor, input, signal);
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const [stored] = await db.select().from(persons).where(eq(persons.id, created.value.id));
    expect(stored?.customFields).toEqual({ callback_phone: first });

    const second = "+٩٩ (١٢٣) ٤٥٦-٧٨٩٠";
    const updated = await updatePerson(
      db,
      actor,
      personUpdateInput.parse({ id: created.value.id, customFields: { callback_phone: second } }),
      signal,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw updated.error;
    const [reloaded] = await db.select().from(persons).where(eq(persons.id, created.value.id));
    expect(reloaded?.customFields).toEqual({ callback_phone: second });
  });
});

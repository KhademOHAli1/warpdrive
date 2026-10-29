import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { type ContactActor, createPerson, updatePerson } from "./personsRepo";
import { personCreateInput, personUpdateInput } from "./schemas";

it("creates and updates a person through the shared boundary while retaining authored Unicode phones in PostgreSQL", async () => {
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
    const createdPhone = { label: "work", value: "+۹۹ (۱۲۳) ۴۵۶.۷۸۹۰", primary: true };
    // createPersonAction parses this exact schema before entering the real persistence authority.
    const input = personCreateInput.safeParse({ name: "مخاطب آزمایشی", phones: [createdPhone] });
    expect(input.success).toBe(true);
    if (!input.success) return;
    const created = await createPerson(db, actor, input.data, signal);
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const [stored] = await db.select().from(persons).where(eq(persons.id, created.value.id));
    expect(stored?.phones).toEqual([createdPhone]);

    const updatedPhone = { label: "mobile", value: "+٩٩ (١٢٣) ٤٥٦.٧٨٩٠", primary: true };
    const update = personUpdateInput.safeParse({ id: created.value.id, phones: [updatedPhone] });
    expect(update.success).toBe(true);
    if (!update.success) return;
    const saved = await updatePerson(db, actor, update.data, signal);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw saved.error;
    const [reloaded] = await db.select().from(persons).where(eq(persons.id, created.value.id));
    expect(reloaded?.phones).toEqual([updatedPhone]);
  });
});

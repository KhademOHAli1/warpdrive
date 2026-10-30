import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { persons } from "@/db/schema";
import { contactSearchCondition } from "./contactSearch";

it("ignores an empty search", () => {
  expect(contactSearchCondition("  ", [persons.name])).toBeUndefined();
});

it("binds and escapes wildcard characters as literal search text", () => {
  const fragment = contactSearchCondition("  50%_\\quote'  ", [persons.name, persons.primaryEmail]);
  if (fragment === undefined) throw new Error("Expected a search condition");
  const query = new PgDialect().sqlToQuery(fragment);
  expect(query.sql).not.toContain("quote");
  expect(query.params).toEqual(["%50\\%\\_\\\\quote'%", "\\", "%50\\%\\_\\\\quote'%", "\\"]);
  expect(query.sql).toContain(" or ");
});

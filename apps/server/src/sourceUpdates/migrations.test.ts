import { expect, it } from "vite-plus/test";
import { incompatibleMigration } from "./migrations.ts";

it("allows additional forward migrations and switching back when schema histories agree", () => {
  expect(incompatibleMigration({ "001": "a" }, { "001": "a", "002": "b" })).toBeNull();
  expect(incompatibleMigration({ "001": "a", "002": "b" }, { "001": "a", "002": "b" })).toBeNull();
});
it("rejects removed, rewritten, and newly inserted historical migrations", () => {
  expect(incompatibleMigration({ "001": "a", "003": "c" }, { "001": "a" })).toBe("003");
  expect(incompatibleMigration({ "001": "a" }, { "001": "rewritten" })).toBe("001");
  expect(
    incompatibleMigration({ "001": "a", "003": "c" }, { "001": "a", "002": "b", "003": "c" }),
  ).toBe("002");
});

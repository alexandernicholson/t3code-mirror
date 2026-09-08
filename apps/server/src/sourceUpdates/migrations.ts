/** Applied migrations are append-only across branches, including their numeric execution order. */
export function incompatibleMigration(
  current: Readonly<Record<string, unknown>>,
  target: Readonly<Record<string, unknown>>,
): string | null {
  let highest = -1;
  for (const [id, hash] of Object.entries(current)) {
    if (!/^\d+$/.test(id) || typeof hash !== "string" || target[id] !== hash) return id;
    highest = Math.max(highest, Number(id));
  }
  for (const [id, hash] of Object.entries(target)) {
    if (
      !/^\d+$/.test(id) ||
      typeof hash !== "string" ||
      (!(id in current) && Number(id) <= highest)
    )
      return id;
  }
  return null;
}

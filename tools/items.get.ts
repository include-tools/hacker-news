import { Item, err, fetchJson, normalizeRootItem } from "../lib/hn.ts";

/**
 * @effect readOnly
 */
export default async function tool(id: number): Promise<Item> {
  if (!Number.isInteger(id) || id <= 0) {
    throw err("validation_error", "id must be a positive integer");
  }
  const raw = await fetchJson(`/v0/item/${id}.json`);
  if (raw === null) {
    throw err("not_found", `no item with id ${id}`);
  }
  return normalizeRootItem(raw);
}

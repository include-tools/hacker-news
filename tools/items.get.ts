import { Item, err, fetchJson, normalizeItem } from "../lib/hn.ts";

/**
 * Resolve a single Hacker News item of any type (story, comment, job, poll,
 * pollopt) by its numeric id into the canonical normalized item. `deleted`/`dead`
 * items are returned (with their flags set) rather than skipped, because the
 * caller asked for that specific id. `kids_count` is returned but the `kids`
 * array is not — use threads.get to walk a discussion.
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
  return normalizeItem(raw);
}

import {
  Item,
  MemberBuckets,
  emptyBuckets,
  err,
  fetchJson,
  fetchMemberItem,
  tallySkip,
} from "../lib/hn.ts";

interface RecentItemsResult {
  max_id: number; // the maxitem value observed this call
  requested_limits: { limit: number };
  actual_counts: {
    scan_budget: number; // ids the walk may inspect = 2 * limit
    ids_scanned: number; // ids actually walked downward from max_id
    items_returned: number;
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
  };
  truncated: boolean; // always true — older items always exist below the window
  items: Item[]; // up to `limit` canonical Items, newest-first (descending id)
}

/**
 * Discover the newest items on Hacker News of any type by reading `maxitem` and
 * walking ids downward, hydrating up to `limit` live ones. A `scan_budget` of
 * `2 * limit` bounds the walk so a run of dead/deleted ids cannot scan forever;
 * `items_returned < limit` means the budget was exhausted before `limit` live
 * items were found. `truncated` is always true (older items always exist below).
 * @effect readOnly
 */
export default async function tool(limit?: number): Promise<RecentItemsResult> {
  const lim = limit ?? 10;
  if (!Number.isInteger(lim) || lim < 1 || lim > 30) {
    throw err("validation_error", "limit must be an integer between 1 and 30");
  }

  const maxId = await fetchJson(`/v0/maxitem.json`);
  if (!Number.isInteger(maxId)) {
    throw err("upstream_error", "maxitem did not return an integer");
  }

  const scanBudget = 2 * lim;
  const buckets: MemberBuckets = emptyBuckets();
  const items: Item[] = [];
  let idsScanned = 0;
  let id = maxId;
  while (items.length < lim && idsScanned < scanBudget) {
    const outcome = await fetchMemberItem(id);
    idsScanned++;
    if (outcome.kind === "ok") items.push(outcome.item);
    else tallySkip(buckets, outcome);
    id--;
  }

  return {
    max_id: maxId,
    requested_limits: { limit: lim },
    actual_counts: {
      scan_budget: scanBudget,
      ids_scanned: idsScanned,
      items_returned: items.length,
      skipped_deleted_or_dead: buckets.skipped_deleted_or_dead,
      skipped_null: buckets.skipped_null,
      failed_fetch: buckets.failed_fetch,
    },
    truncated: true,
    items,
  };
}

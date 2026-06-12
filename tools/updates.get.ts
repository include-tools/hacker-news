import { err, fetchJson } from "../lib/hn.ts";

const ITEM_IDS_LIMIT = 100;
const PROFILES_LIMIT = 100;

interface UpdatesResult {
  item_ids: number[]; // recently changed item ids, upstream order; [] if none
  profiles: string[]; // recently changed usernames, upstream order; [] if none
  requested_limits: { item_ids: number; profiles: number };
  actual_counts: {
    item_ids: number;
    profiles: number;
    item_ids_available: number;
    profiles_available: number;
  };
  truncated: boolean;
}

/**
 * Return Hacker News's change feed — recently changed item ids and usernames —
 * in one cheap pass-through read for polling loops. Does not hydrate and does
 * not advance any cursor or consume events; arrays are relayed in upstream order
 * up to fixed caps (the agent slices further client-side before hydrating).
 * @effect readOnly
 */
export default async function tool(): Promise<UpdatesResult> {
  const raw = await fetchJson(`/v0/updates.json`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw err("upstream_error", "expected an updates object");
  }
  const allItemIds: number[] = Array.isArray(raw.items) ? raw.items : [];
  const allProfiles: string[] = Array.isArray(raw.profiles) ? raw.profiles : [];
  const item_ids = allItemIds.slice(0, ITEM_IDS_LIMIT);
  const profiles = allProfiles.slice(0, PROFILES_LIMIT);
  return {
    item_ids,
    profiles,
    requested_limits: { item_ids: ITEM_IDS_LIMIT, profiles: PROFILES_LIMIT },
    actual_counts: {
      item_ids: item_ids.length,
      profiles: profiles.length,
      item_ids_available: allItemIds.length,
      profiles_available: allProfiles.length,
    },
    truncated: allItemIds.length > item_ids.length || allProfiles.length > profiles.length,
  };
}

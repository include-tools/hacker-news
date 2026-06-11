import { err, fetchJson } from "../lib/hn.ts";

interface UpdatesResult {
  item_ids: number[]; // recently changed item ids, upstream order; [] if none
  profiles: string[]; // recently changed usernames, upstream order; [] if none
  actual_counts: { item_ids: number; profiles: number };
}

/**
 * Return Hacker News's change feed — recently changed item ids and usernames —
 * in one cheap pass-through read for polling loops. Does not hydrate and does
 * not advance any cursor or consume events; arrays are relayed in upstream order
 * and not capped (the agent slices client-side before hydrating).
 * @effect readOnly
 */
export default async function tool(): Promise<UpdatesResult> {
  const raw = await fetchJson(`/v0/updates.json`);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw err("upstream_error", "expected an updates object");
  }
  const item_ids: number[] = Array.isArray(raw.items) ? raw.items : [];
  const profiles: string[] = Array.isArray(raw.profiles) ? raw.profiles : [];
  return {
    item_ids,
    profiles,
    actual_counts: { item_ids: item_ids.length, profiles: profiles.length },
  };
}

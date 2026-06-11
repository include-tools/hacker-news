import {
  ItemType,
  MemberBuckets,
  emptyBuckets,
  err,
  fetchJson,
  fetchMemberItem,
  tallySkip,
} from "../lib/hn.ts";

type Kind = "top" | "new" | "best" | "ask" | "show" | "job";

const FEEDS: Record<string, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

interface StorySummary {
  id: number;
  type: ItemType; // disambiguates job vs story in mixed feeds
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  posted_at?: Date;
  comments: number; // `descendants ?? 0`
}

interface StoryListResult {
  kind: string;
  requested_limits: { limit: number; offset: number };
  actual_counts: {
    feed_ids_available: number;
    ids_selected: number;
    stories_returned: number;
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
  };
  truncated: boolean;
  stories: StorySummary[];
}

/**
 * List a ranked Hacker News feed (front page or category) as bounded story
 * summaries, hydrating each selected id into a lean record. Summaries omit
 * `text`/linkage to stay bounded — use items.get for an Ask HN body. The `top`
 * and `job` feeds legitimately mix in job posts (tagged via `type`).
 * @effect readOnly
 */
export default async function tool(
  kind?: Kind,
  limit?: number,
  offset?: number,
): Promise<StoryListResult> {
  const k: string = kind ?? "top";
  const endpoint = FEEDS[k];
  if (endpoint === undefined) {
    throw err("validation_error", `kind must be one of ${Object.keys(FEEDS).join(", ")}`);
  }
  const lim = limit ?? 10;
  if (!Number.isInteger(lim) || lim < 1 || lim > 30) {
    throw err("validation_error", "limit must be an integer between 1 and 30");
  }
  const off = offset ?? 0;
  if (!Number.isInteger(off) || off < 0) {
    throw err("validation_error", "offset must be a non-negative integer");
  }

  const ids = await fetchJson(`/v0/${endpoint}.json`);
  if (!Array.isArray(ids)) {
    throw err("upstream_error", "expected an array of story ids");
  }
  const selected: number[] = ids.slice(off, off + lim);

  const buckets: MemberBuckets = emptyBuckets();
  const stories: StorySummary[] = [];
  for (const id of selected) {
    const outcome = await fetchMemberItem(id);
    if (outcome.kind !== "ok") {
      tallySkip(buckets, outcome);
      continue;
    }
    const it = outcome.item;
    const summary: StorySummary = {
      id: it.id,
      type: it.type,
      comments: it.descendants ?? 0,
    };
    if (it.title !== undefined) summary.title = it.title;
    if (it.url !== undefined) summary.url = it.url;
    if (it.by !== undefined) summary.by = it.by;
    if (it.score !== undefined) summary.score = it.score;
    if (it.posted_at !== undefined) summary.posted_at = it.posted_at;
    stories.push(summary);
  }

  return {
    kind: k,
    requested_limits: { limit: lim, offset: off },
    actual_counts: {
      feed_ids_available: ids.length,
      ids_selected: selected.length,
      stories_returned: stories.length,
      skipped_deleted_or_dead: buckets.skipped_deleted_or_dead,
      skipped_null: buckets.skipped_null,
      failed_fetch: buckets.failed_fetch,
    },
    truncated: ids.length > off + selected.length,
    stories,
  };
}

import {
  Item,
  MemberBuckets,
  emptyBuckets,
  err,
  fetchJson,
  fetchMemberItem,
  tallySkip,
} from "../lib/hn.ts";

interface UserResult {
  id: string; // the username (case-sensitive, as upstream returns)
  created_at: Date;
  karma: number;
  about?: string; // raw HTML bio; omitted if absent
  submitted_count: number; // length of upstream `submitted` (0 if none)
  requested_limits: { include_recent: number };
  actual_counts: {
    submissions_requested: number; // min(include_recent, submitted_count)
    submissions_returned: number;
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
  };
  recent_submissions: Item[]; // canonical Items, newest-first; [] when include_recent = 0
}

/**
 * Resolve a Hacker News user profile by (case-sensitive) username and,
 * optionally, hydrate their most-recent submissions into items. The full
 * `submitted` list (potentially thousands of ids) is never returned — only its
 * length (`submitted_count`) and up to `include_recent` hydrated records.
 * @effect readOnly
 */
export default async function tool(
  username: string,
  include_recent?: number,
): Promise<UserResult> {
  if (typeof username !== "string" || username.trim() === "") {
    throw err("validation_error", "username must be a non-empty string");
  }
  const include = include_recent ?? 0;
  if (!Number.isInteger(include) || include < 0 || include > 30) {
    throw err("validation_error", "include_recent must be an integer between 0 and 30");
  }

  const raw = await fetchJson(`/v0/user/${username}.json`);
  if (raw === null) {
    throw err("not_found", `no user ${username}`);
  }
  const submitted: number[] = Array.isArray(raw.submitted) ? raw.submitted : [];

  const buckets: MemberBuckets = emptyBuckets();
  const recent: Item[] = [];
  let requested = 0;
  if (include > 0) {
    const slice = submitted.slice(0, include);
    requested = slice.length;
    for (const id of slice) {
      const outcome = await fetchMemberItem(id);
      if (outcome.kind === "ok") recent.push(outcome.item);
      else tallySkip(buckets, outcome);
    }
  }

  const result: UserResult = {
    id: raw.id,
    created_at: new Date(raw.created * 1000),
    karma: raw.karma ?? 0,
    submitted_count: submitted.length,
    requested_limits: { include_recent: include },
    actual_counts: {
      submissions_requested: requested,
      submissions_returned: recent.length,
      skipped_deleted_or_dead: buckets.skipped_deleted_or_dead,
      skipped_null: buckets.skipped_null,
      failed_fetch: buckets.failed_fetch,
    },
    recent_submissions: recent,
  };
  if (raw.about !== undefined) result.about = raw.about;
  return result;
}

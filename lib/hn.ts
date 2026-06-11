// Shared helpers for every Hacker News tool (tool rule 10): one host, one fetch
// primitive, one item normaliser, one error constructor, and the skip/fail
// accounting shared by every fan-out tool. Never copied per entry file.

const BASE = "https://hacker-news.firebaseio.com";

export type ItemType =
  | "story"
  | "comment"
  | "job"
  | "poll"
  | "pollopt"
  | "unknown";

/** The canonical normalized item shared by every tool that returns item data. */
export interface Item {
  id: number; // required — the upstream id (echoes the request)
  type: ItemType; // required — "unknown" only if upstream omits `type`
  by?: string; // author username; omitted on deleted items
  posted_at?: Date; // native Date from `time`*1000; omitted if no `time`
  title?: string; // story/poll/job title (raw HTML); omitted otherwise
  url?: string; // story/job target; omitted otherwise; may be "" for jobs
  text?: string; // comment/ask/job/pollopt body (raw HTML); omitted otherwise
  score?: number; // points, or a pollopt's votes; omitted if absent
  descendants?: number; // total comment count (story/poll); omitted otherwise
  kids_count: number; // required — count of direct child comments (0 if none)
  parent?: number; // comment/pollopt: parent item id; omitted otherwise
  poll?: number; // pollopt: parent poll id; omitted otherwise
  part_ids?: number[]; // poll: pollopt ids in display order; omitted otherwise
  deleted: boolean; // required — true only if upstream `deleted` is true
  dead: boolean; // required — true only if upstream `dead` is true
}

export type ErrorCode = "validation_error" | "not_found" | "upstream_error";

/** Construct the taxonomy `Error` whose message is `"<code>: <detail>"`. */
export function err(code: ErrorCode, detail: string): Error {
  return new Error(`${code}: ${detail}`);
}

/**
 * Issue the single `GET https://hacker-news.firebaseio.com{path}` for a **root**
 * resource. No retries, no `?print=pretty`, no headers. Maps non-2xx and
 * non-JSON bodies to `upstream_error`; returns the parsed value (including the
 * JSON literal `null`, which the caller interprets as `not_found`).
 */
export async function fetchJson(path: string): Promise<any> {
  const resp = await fetch(`${BASE}${path}`);
  if (resp.status < 200 || resp.status >= 300) {
    throw err("upstream_error", `Hacker News API returned ${resp.status}`);
  }
  try {
    return await resp.json();
  } catch {
    throw err("upstream_error", "Hacker News API returned a non-JSON body");
  }
}

/** Project an upstream item object into the canonical normalized `Item`. */
export function normalizeItem(raw: any): Item {
  const item: Item = {
    id: raw.id,
    type: (raw.type ?? "unknown") as ItemType,
    kids_count: Array.isArray(raw.kids) ? raw.kids.length : 0,
    deleted: raw.deleted === true,
    dead: raw.dead === true,
  };
  if (raw.by !== undefined) item.by = raw.by;
  if (typeof raw.time === "number") item.posted_at = new Date(raw.time * 1000);
  if (raw.title !== undefined) item.title = raw.title;
  if (raw.url !== undefined) item.url = raw.url; // "" preserved, distinct from omitted
  if (raw.text !== undefined) item.text = raw.text;
  if (raw.score !== undefined) item.score = raw.score;
  if (raw.descendants !== undefined) item.descendants = raw.descendants;
  if (raw.parent !== undefined) item.parent = raw.parent;
  if (raw.poll !== undefined) item.poll = raw.poll;
  if (Array.isArray(raw.parts)) item.part_ids = raw.parts;
  return item;
}

/** The skip/fail buckets shared by every fan-out tool's `actual_counts`. */
export interface MemberBuckets {
  skipped_deleted_or_dead: number;
  skipped_null: number;
  failed_fetch: number;
}

export function emptyBuckets(): MemberBuckets {
  return { skipped_deleted_or_dead: 0, skipped_null: 0, failed_fetch: 0 };
}

/**
 * Outcome of fetching one **fan-out member** item. A missing/deleted/dead member
 * or a per-item non-2xx is never fatal — it is classified here and tallied by
 * the calling tool, which then returns a partial result.
 */
export type MemberOutcome =
  | { kind: "ok"; item: Item; kids: number[] }
  | { kind: "null" }
  | { kind: "deleted_or_dead" }
  | { kind: "failed" };

/** Fetch and classify a single member item by id (no throw on per-item error). */
export async function fetchMemberItem(id: number): Promise<MemberOutcome> {
  const resp = await fetch(`${BASE}/v0/item/${id}.json`);
  if (resp.status < 200 || resp.status >= 300) {
    return { kind: "failed" };
  }
  let raw: any;
  try {
    raw = await resp.json();
  } catch {
    return { kind: "failed" };
  }
  if (raw === null) {
    return { kind: "null" };
  }
  const item = normalizeItem(raw);
  if (item.deleted || item.dead) {
    return { kind: "deleted_or_dead" };
  }
  const kids: number[] = Array.isArray(raw.kids) ? raw.kids : [];
  return { kind: "ok", item, kids };
}

/** Increment the matching skip/fail bucket for a non-ok member outcome. */
export function tallySkip(buckets: MemberBuckets, outcome: MemberOutcome): void {
  if (outcome.kind === "null") buckets.skipped_null++;
  else if (outcome.kind === "deleted_or_dead") buckets.skipped_deleted_or_dead++;
  else if (outcome.kind === "failed") buckets.failed_fetch++;
}

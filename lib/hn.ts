// Shared helpers for every Hacker News tool (tool rule 10): one host, one fetch
// primitive, one item normaliser, one error constructor, and the skip/fail
// accounting shared by every fan-out tool. Never copied per entry file.

const BASE = "https://hacker-news.firebaseio.com";
const ALGOLIA_BASE = "https://hn.algolia.com";

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

export type SearchSort = "relevance" | "date";

export interface AlgoliaSearchHit {
  object_id: string;
  item_id?: number;
  tags: string[];
  author?: string;
  created_at?: Date;
  updated_at?: Date;
  title?: string;
  url?: string;
  story_text?: string;
  comment_text?: string;
  story_id?: number;
  story_title?: string;
  story_url?: string;
  parent_id?: number;
  points?: number;
  num_comments?: number;
}

export interface AlgoliaSearchResult {
  sort: SearchSort;
  requested_filters: {
    query?: string;
    tags: string[];
    numeric_filters: string[];
    page: number;
    hits_per_page: number;
  };
  actual_counts: {
    hits_returned: number;
    nb_hits: number;
    nb_pages: number;
    page: number;
    hits_per_page: number;
    processing_time_ms?: number;
  };
  hits: AlgoliaSearchHit[];
}

interface AlgoliaSearchRequest {
  query?: string;
  sort: SearchSort;
  tags: string[];
  numericFilters: string[];
  page: number;
  hitsPerPage: number;
}

export function validateSearchSort(sort: string | undefined): SearchSort {
  const value = sort ?? "relevance";
  if (value !== "relevance" && value !== "date") {
    throw err("validation_error", "sort must be relevance or date");
  }
  return value;
}

export function validateSearchLimit(limit: number | undefined): number {
  const value = limit ?? 10;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw err("validation_error", "limit must be an integer between 1 and 50");
  }
  return value;
}

export function validateSearchPage(page: number | undefined): number {
  const value = page ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    throw err("validation_error", "page must be a non-negative integer");
  }
  return value;
}

export function normalizeOptionalQuery(query: string | undefined): string | undefined {
  if (query === undefined) return undefined;
  if (typeof query !== "string") {
    throw err("validation_error", "query must be a string");
  }
  const trimmed = query.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function validateTagUsername(username: string | undefined): string | undefined {
  if (username === undefined) return undefined;
  if (typeof username !== "string" || !/^[A-Za-z0-9_-]+$/.test(username)) {
    throw err(
      "validation_error",
      "author must contain only letters, numbers, underscores, or hyphens",
    );
  }
  return username;
}

export function addCreatedAtFilters(
  numericFilters: string[],
  since: number | undefined,
  until: number | undefined,
): void {
  if (since !== undefined && (!Number.isInteger(since) || since < 0)) {
    throw err("validation_error", "since must be a non-negative Unix timestamp");
  }
  if (until !== undefined && (!Number.isInteger(until) || until < 0)) {
    throw err("validation_error", "until must be a non-negative Unix timestamp");
  }
  if (since !== undefined && until !== undefined && since > until) {
    throw err("validation_error", "since must be less than or equal to until");
  }
  if (since !== undefined) numericFilters.push(`created_at_i>=${since}`);
  if (until !== undefined) numericFilters.push(`created_at_i<=${until}`);
}

export function addMinNumericFilter(
  numericFilters: string[],
  field: "points" | "num_comments",
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw err("validation_error", `${field} minimum must be a non-negative integer`);
  }
  numericFilters.push(`${field}>=${value}`);
}

/**
 * Issue a single unauthenticated Algolia HN Search API request.
 * Non-2xx responses are mapped to the shared upstream_error taxonomy, appending
 * the upstream message/error field when the body is JSON.
 */
export async function fetchAlgoliaJson(path: string): Promise<any> {
  const resp = await fetch(`${ALGOLIA_BASE}${path}`);
  const text = await resp.text();
  if (resp.status < 200 || resp.status >= 300) {
    let detail = `Algolia HN Search API returned ${resp.status}`;
    try {
      const parsed = JSON.parse(text);
      const message = parsed.message ?? parsed.error;
      if (typeof message === "string" && message !== "") {
        detail += `: ${message}`;
      }
    } catch {
      // HTML/non-JSON error bodies are common enough to leave as status-only.
    }
    throw err("upstream_error", detail);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw err("upstream_error", "Algolia HN Search API returned a non-JSON body");
  }
}

/** Search `/api/v1/search` or `/api/v1/search_by_date` with bounded output. */
export async function searchAlgolia(req: AlgoliaSearchRequest): Promise<AlgoliaSearchResult> {
  const endpoint = req.sort === "date" ? "/api/v1/search_by_date" : "/api/v1/search";
  const params: string[] = [];
  const addParam = (key: string, value: string): void => {
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  };
  if (req.query !== undefined) addParam("query", req.query);
  addParam("tags", req.tags.join(","));
  if (req.numericFilters.length > 0) {
    addParam("numericFilters", req.numericFilters.join(","));
  }
  addParam("page", String(req.page));
  addParam("hitsPerPage", String(req.hitsPerPage));

  const raw = await fetchAlgoliaJson(`${endpoint}?${params.join("&")}`);
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.hits)) {
    throw err("upstream_error", "expected an Algolia search result object");
  }
  const result: AlgoliaSearchResult = {
    sort: req.sort,
    requested_filters: {
      tags: req.tags,
      numeric_filters: req.numericFilters,
      page: req.page,
      hits_per_page: req.hitsPerPage,
    },
    actual_counts: {
      hits_returned: raw.hits.length,
      nb_hits: typeof raw.nbHits === "number" ? raw.nbHits : raw.hits.length,
      nb_pages: typeof raw.nbPages === "number" ? raw.nbPages : 0,
      page: typeof raw.page === "number" ? raw.page : req.page,
      hits_per_page: typeof raw.hitsPerPage === "number" ? raw.hitsPerPage : req.hitsPerPage,
    },
    hits: raw.hits.map(normalizeAlgoliaHit),
  };
  if (req.query !== undefined) result.requested_filters.query = req.query;
  if (typeof raw.processingTimeMS === "number") {
    result.actual_counts.processing_time_ms = raw.processingTimeMS;
  }
  return result;
}

function normalizeAlgoliaHit(raw: any): AlgoliaSearchHit {
  const objectId = String(raw.objectID ?? raw.id ?? "");
  const hit: AlgoliaSearchHit = {
    object_id: objectId,
    tags: Array.isArray(raw._tags) ? raw._tags.filter((tag: any) => typeof tag === "string") : [],
  };
  const itemId = Number(objectId);
  if (Number.isInteger(itemId) && itemId > 0) hit.item_id = itemId;
  if (typeof raw.author === "string") hit.author = raw.author;
  if (typeof raw.created_at === "string") hit.created_at = new Date(raw.created_at);
  if (typeof raw.updated_at === "string") hit.updated_at = new Date(raw.updated_at);
  if (typeof raw.title === "string") hit.title = raw.title;
  if (typeof raw.url === "string") hit.url = raw.url;
  if (typeof raw.story_text === "string") hit.story_text = raw.story_text;
  if (typeof raw.comment_text === "string") hit.comment_text = raw.comment_text;
  if (typeof raw.story_id === "number") hit.story_id = raw.story_id;
  if (typeof raw.story_title === "string") hit.story_title = raw.story_title;
  if (typeof raw.story_url === "string") hit.story_url = raw.story_url;
  if (typeof raw.parent_id === "number") hit.parent_id = raw.parent_id;
  if (typeof raw.points === "number") hit.points = raw.points;
  if (typeof raw.num_comments === "number") hit.num_comments = raw.num_comments;
  return hit;
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

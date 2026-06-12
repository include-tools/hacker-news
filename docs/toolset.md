# Hacker News toolset

## Toolset purpose

Give a coding agent bounded, task-shaped read access to Hacker News content and
search so it can perform the documented outcomes in `docs/use-cases.md`:
summarise feeds (front page, Show/Ask/Job), search stories and comments, expand a
single item, reconstruct a comment thread, profile a user, poll for changes, and
compute client-side analytics over fetched or searched results.

The toolset wraps two official public read APIs (see `docs/service-research.md`):
the Hacker News Firebase JSON API (`https://hacker-news.firebaseio.com/v0/`) and
the Algolia HN Search API (`https://hn.algolia.com/api/v1/`). Firebase remains
the canonical identity store: every feed is a bare array of item ids, and every
item must be fetched one id at a time. Algolia supplies server-side search and
exact Algolia user lookup with its own result shape. The agent-facing value is
therefore **fan-out/search compression with explicit bounds**.

Every tool is read-only. The Hacker News API documents no write, vote, post, or
moderation endpoint, so this toolset cannot mutate anything; that is a property
of the upstream, not an omission (see [Out of scope](#out-of-scope)).

## Agent contract

- **Pick the task tool, not the endpoint.** To see "what's on HN right now" use
  `stories.list`; to read a discussion use `threads.get`; to look up one known
  id use `items.get`. Only reach for the raw change feeds (`updates.get`,
  `items.recent`) when monitoring for change.
- **Everything that fans out is bounded.** Feeds, threads, and submission
  hydration are capped by hard limits and never return unbounded upstream arrays
  (`kids`, `submitted`) in full. When a result is capped you get a `truncated`
  flag and a `requested_limits` / `actual_counts` pair so you can detect and
  page past the boundary yourself.
- **`null` upstream is not an error for fan-out members.** A missing/deleted item
  inside a feed or thread is skipped and counted, not fatal. A missing **root**
  resource (the item, user, or feed you directly asked for) is a `not_found`.
- **Reads are live, not stable.** No read is idempotent: scores, comment counts,
  edits, `dead`/`deleted` flags, feeds, and the change feeds all move over time.
  Treat every result as a snapshot; re-call to refresh.
- **Text is raw HTML.** `title`, `text`, `about`, and `url` are passed through
  exactly as Hacker News returns them (HTML markup and entities **not** decoded
  or sanitised). Strip/escape on the agent side before display.
- **Use search tools for server-side keyword work.** `stories.search` and
  `comments.search` call Algolia HN Search. Analytics outside documented search
  filters are still computed client-side.
- **Timestamps are native `Date`s.** Unix-seconds (`time`, `created`) are
  converted to `Date` objects (`posted_at`, `created_at`); do not expect epoch
  integers.

## Resource and concept model

Hacker News has two primary Firebase resources, derived Firebase feeds, and a
separate Algolia search index:

- **Item** — the universal content node. One integer `id`; a `type` field
  discriminates `story | comment | job | poll | pollopt`. Stories, Ask HN, Show
  HN, jobs, polls, poll options, and comments are all items. Fields are present
  only when applicable (HN omits empty/false fields). `kids` holds direct child
  comment ids in ranked display order; full threads require recursive fetches.
- **User** — a profile keyed by a **case-sensitive** username string. Carries
  `karma`, `created`, optional `about`, and a `submitted` id list of the user's
  stories, polls, and comments (can be thousands long).
- **Ranked feeds** — `top`, `new`, `best`, `ask`, `show`, `job`: bare arrays of
  item ids in ranked order (≤500 for top/new/best, ≤200 for ask/show/job).
- **maxitem** — the current largest item id (a bare integer); walking ids
  downward from it discovers brand-new items of any type.
- **updates** — a change feed `{ items: id[], profiles: username[] }` of recently
  changed items and profiles.
- **Algolia search hits** — paginated story/comment results from
  `/api/v1/search` or `/api/v1/search_by_date`, with metadata (`nbHits`,
  `nbPages`, `hitsPerPage`) and hit fields such as `objectID`, `title`,
  `comment_text`, `_tags`, `story_id`, `parent_id`, and timestamps.

### Canonical normalized `Item`

`items.get`, the root of `threads.get`, each of `users.get`'s
`recent_submissions`, and each of `items.recent`'s `items` share **one** stable
shape. Fields marked required are always present; `?` fields are **omitted**
(absent from the object) when the upstream omits them — they are never `null`.

```ts
type ItemType = "story" | "comment" | "job" | "poll" | "pollopt" | "unknown";

interface Item {
  id: number;            // required — the upstream id (echoes the request)
  type: ItemType;        // required — "unknown" only if upstream omits `type`
  by?: string;           // author username; omitted on deleted items
  posted_at?: Date;      // native Date from `time`*1000; omitted if no `time`
  title?: string;        // story/poll/job title (raw HTML); omitted otherwise
  url?: string;          // story/job target; omitted otherwise; may be "" for jobs
  text?: string;         // comment/ask/job/pollopt body (raw HTML); omitted otherwise
  score?: number;        // points, or a pollopt's votes; omitted if absent
  descendants?: number;  // total comment count (story/poll); omitted otherwise
  kids_count: number;    // required — count of direct child comments (0 if none)
  parent?: number;       // comment/pollopt: parent item id; omitted otherwise
  poll?: number;         // pollopt: parent poll id; omitted otherwise
  part_ids?: number[];   // poll: pollopt ids in display order; omitted otherwise
  deleted: boolean;      // required — true only if upstream `deleted` is true
  dead: boolean;         // required — true only if upstream `dead` is true
}
```

- **Nullability:** optional fields are omitted, never `null`. The four required
  fields (`id`, `type`, `kids_count`, `deleted`, `dead`) are always present.
- **`kids` is never returned as an array** by `Item`; only `kids_count`. The raw
  `kids` list can be large and unbounded — thread traversal goes through
  `threads.get`, which bounds it. `part_ids` *is* returned in full because poll
  option counts are inherently tiny (single digits), so it carries no unbounded
  fan-out risk.
- **`url` empty string** (jobs sometimes have `url: ""`) is preserved as `""`,
  distinct from omitted.

## Authentication

**None — and the toolset must send none.** The Firebase API and Algolia HN
Search API are fully public and unauthenticated: no API keys, bearer tokens,
OAuth, cookies, or credential query/headers are documented. There is no
credential to inject and nothing to read from the environment.

Contract consequence for tests: every host-call assertion checks that requests
carry **no** `Authorization` header and no credential query parameter. Adding
auth would be a defect, not a feature.

## Global bounds and error policy

**Hosts.** Exactly two hosts are contacted and both are declared in
`allowed_hosts`: `hacker-news.firebaseio.com` and `hn.algolia.com`.

**Request shape.** Firebase calls are `GET https://hacker-news.firebaseio.com/v0/…json`.
Algolia calls are `GET https://hn.algolia.com/api/v1/…`. No request body, no
custom headers, no credentials. Firebase `?print=pretty` is never sent.

**Retries / determinism.** No automatic retries. Each logical fetch maps to
exactly one host call, so call-count and call-order assertions are exact. A
transient upstream failure surfaces as `upstream_error` (root) or a counted
`failed_fetch` (fan-out member) rather than being silently retried.

**Pagination.** Firebase has no cursors, `limit`, `offset`, or `page` params; id
lists are returned whole and sliced client-side. Algolia search uses documented
`page` and `hitsPerPage`; probes showed `page: 0`, so search tools expose
zero-based pages and cap `hitsPerPage` at 50. Search `truncated` means the
returned Algolia page is not the last page (`page + 1 < nbPages`).

**Error taxonomy.** Tools signal failure by throwing `Error` whose message is
`"<code>: <detail>"`. Three codes, stable across all tools:

| Code | Meaning | When |
|------|---------|------|
| `validation_error` | Caller-side bad input | Detected **before any** host call; the failing tool makes **zero** upstream requests. |
| `not_found` | A **root** resource does not exist | The directly-requested item / user returned the JSON literal `null` (HTTP 200, null body). |
| `upstream_error` | Generic upstream failure | A **root** request returned non-2xx, a non-JSON body, or an unexpected shape (e.g. a feed endpoint that did not return an array). |

`null` / `deleted` / `dead` / per-item non-2xx for a **fan-out member** (a feed
story, a thread comment, a hydrated submission) is **never** fatal: the member is
skipped and tallied (see counts below), and the tool returns a partial result.

**Truncation & accounting (every fan-out tool).** Bounded, sliced, recursive, or
fan-out tools return two stable accounting objects in **both** full and partial
results, plus (where an ordered slice applies) a `truncated` boolean:

- `requested_limits` — echoes the effective bounds actually used (after
  defaulting/clamping), so the agent sees what was asked.
- `actual_counts` — what happened, with the invariant that the selected-id count
  equals the sum of returned + each skip/fail bucket. The feed-list / profile /
  maxitem **root** lookups are *not* counted as items; only resolved member
  records and their skip/fail buckets are. Each tool's section defines its exact
  fields and which of {root lookups, hydrated records, null, deleted/dead, failed
  fetch} each bucket includes.
- `truncated` — `true` when more ordered upstream ids/usernames/search pages
  existed beyond what was returned (so the agent can page, widen bounds, or poll
  again as that tool's pagination strategy allows).

**Effects.** Every tool is `@effect readOnly` (no side effects; in particular
`updates.get` does **not** advance any cursor, consume events, or take a lease —
it is a plain read of HN's change snapshot). **No tool is `@idempotent`**: the
backing data is mutable and the change feeds move every poll, so an earlier
result cannot be reused in place of a refetch.

**Native types.** Timestamps are `Date`. All other fields are primitives, arrays
of primitives, or the objects defined here. No JSON stand-ins (no epoch-int
"dates", no stringified numbers). This makes the tools codemode-only, which is
the intended invocation path.

**File layout and shared helpers (tool rule 10).** Entry files are named
`{resource}.{method}.ts`: `tools/items.get.ts`, `tools/stories.list.ts`,
`tools/stories.search.ts`, `tools/comments.search.ts`, `tools/threads.get.ts`,
`tools/users.get.ts`, `tools/users.search.ts`, `tools/updates.get.ts`,
`tools/items.recent.ts`. Logic common to them lives in one helper module
included via `additionalTypeScriptGlobs` (e.g. `"additionalTypeScriptGlobs":
["lib/**/*.ts"]` in `toolbox.devpkg.json`) — never copied per file:

- `fetchJson(path)` — issues the single `GET https://hacker-news.firebaseio.com{path}`,
  maps non-2xx → `upstream_error`, parses JSON, returns the value (including
  `null`). No retries, no `?print=pretty`, no headers.
- `normalizeItem(raw)` — the upstream-item → canonical [`Item`](#canonical-normalized-item)
  projection (`time`→`posted_at` `Date`, `kids`→`kids_count`, `parts`→`part_ids`,
  default flags/`type`, omit absent fields).
- `normalizeRootItem(raw)` / `normalizeRootUser(raw)` — validate root
  item/profile objects before projection; malformed root shapes map to
  `upstream_error`, while malformed fan-out members are counted as
  `failed_fetch`.
- `validateFirebaseListLimit(limit)` — shared default/validation for the
  `limit` parameter used by Firebase fan-out tools with the common `1..30` cap.
- `err(code, detail)` — constructs the `"<code>: <detail>"` `Error` for the three
  taxonomy codes.
- Count/accounting helpers maintaining the `requested_limits` / `actual_counts`
  invariants and the skip/fail bucket classification shared by every fan-out tool.
- `fetchAlgoliaJson(path)` / `searchAlgolia(req)` — issue the single
  unauthenticated Algolia request, map non-2xx/non-JSON to `upstream_error`, and
  normalize bounded search hits.

Entry files stay thin (validate → call helpers → assemble result). Each carries a
single `@effect readOnly` JSDoc tag and **no** `@idempotent` tag (rules 8–9).
Descriptions are omitted where `{resource}.{method}` plus the typed signature
already explains the tool (rules 1–2); only a non-obvious bound or behaviour
earns a comment.

## Out of scope

Each exclusion is a property of the upstream API (per `docs/service-research.md`),
not a deferred feature:

- **All writes** — posting, commenting, voting, flagging, favoriting, editing
  profiles. The API documents **no** create/update/delete endpoint; it is
  read-only. There are no idempotency keys or transactions because there are no
  writes. (Those actions exist only on the HN website.)
- **Firebase server-side search / filter / sort / date-range / author query** —
  Firebase offers none. Use the Algolia-backed search tools where their
  documented query/tag/numeric filters apply.
- **Algolia full-text user search** — Algolia documents exact user lookup only.
- **Algolia recursive item lookup (`/api/v1/items/{id}`)** — Algolia documents
  this endpoint, but its response embeds recursive `children` with no documented
  depth or page parameter. The toolset deliberately exposes canonical Firebase
  `items.get` for one item and bounded `threads.get` for comment trees instead
  of inventing behaviour for an unbounded Algolia shape.
- **Aggregate analytics endpoints** — none exist; trends/score-distributions/
  domain-counts (use case #8) are computed agent-side from items these tools
  return.
- **Batch / bulk item fetch** — no multi-id endpoint; fan-out tools fetch ids
  individually (and bound the count).
- **Webhooks / realtime push / Firebase streaming subscriptions** — out of scope
  by design; this is a request/response polling toolset. Change observation is
  via `updates.get` / `items.recent` polling only.
- **Unbounded array retrieval** — the full `kids` tree and the full `submitted`
  list (thousands of ids) are never returned whole; bounded summaries/counts are
  returned instead.
- **HTML sanitisation / entity decoding** — fields are raw HTML passthrough; the
  toolset performs no decoding so behaviour stays faithful and testable.

## Tool inventory

| Tool | Agent outcome (use case) | Upstream endpoints | Effect | Worst-case host calls |
|------|--------------------------|--------------------|--------|-----------------------|
| `items.get` | Expand one item by id (#4) | `item/{id}` | readOnly | 1 |
| `stories.list` | Front page & Show/Ask/Job feeds; analytics source (#1, #8) | `{kind}stories` + `item/{id}`×N | readOnly | 1 + limit (≤ 31) |
| `stories.search` | Search HN stories via Algolia (#2) | Algolia `search` / `search_by_date` | readOnly | 1 |
| `comments.search` | Search HN comments via Algolia (#3) | Algolia `search` / `search_by_date` | readOnly | 1 |
| `threads.get` | Story + comment-thread report (#5) | `item/{id}` (root + recursive comments) | readOnly | 1 + max_nodes (≤ 201) |
| `users.get` | Profile a user; optional submitted-item sample (#6) | `user/{name}` + `item/{id}`×N | readOnly | 1 + include_recent (≤ 31) |
| `users.search` | Exact Algolia user lookup (#6) | Algolia `users/{username}` | readOnly | 1 |
| `updates.get` | Lightweight change feed (#7) | `updates` | readOnly | 1 |
| `items.recent` | Discover brand-new items via count-down (#7) | `maxitem` + `item/{id}`×N | readOnly | 1 + max(3, 2·limit) (≤ 61) |

No tool is `@idempotent` (live mutable data). All calls go only to the two
declared public hosts.

## Tools

### items.get

**Purpose.** Resolve a single Hacker News item of any type (story, comment, job,
poll, pollopt) by its numeric id into the canonical normalized [`Item`](#canonical-normalized-item).

**Use when** the agent already has an item id — from an HN URL
(`news.ycombinator.com/item?id=…`), from a feed/thread result, from a user's
submissions, or from `updates.get` — and wants that one record. Foundational
deep-link/lookup (use case #4).

**Do not use when** you need a story's discussion (use `threads.get`), a whole
feed (use `stories.list`), or to discover ids you don't yet have (use
`stories.list`, `updates.get`, or `items.recent`).

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `id` | `number` | — (required) | Integer `> 0`; else `validation_error` with **zero** host calls. |

**Output.** The canonical [`Item`](#canonical-normalized-item) (single object).
Not a fan-out tool — exactly one host call, no slicing — so it carries **no**
`requested_limits` / `actual_counts` / `truncated`. `deleted`/`dead` items are
**returned** (with `deleted`/`dead` set and content fields omitted) rather than
skipped, because the caller asked for that specific id and the flags are the
answer.

**Bounds and truncation.** None — a single fetch. `kids_count` is returned but
the `kids` array is not (use `threads.get` to walk it).

**Upstream call plan and transformations.**

1. `GET /v0/item/{id}.json`.
2. Validate that the root body is an item object with a positive integer `id`.
   Malformed root objects → `upstream_error`.
3. Map fields: `time`→`posted_at` (`new Date(time*1000)`); `kids`→`kids_count`
   (`kids.length`, else 0); `parts`→`part_ids`; `deleted`/`dead` default `false`;
   `type` default `"unknown"`. Omit every field the upstream omits. `title`,
   `text`, and `url` are passed through as raw HTML.

**Branch and error behaviour.**

- `id` not a positive integer → `validation_error`, no host call.
- Body is JSON `null` → `not_found: no item with id {id}`.
- Non-2xx response → `upstream_error: Hacker News API returned {status}`.
- Non-object or malformed item body → `upstream_error: expected an item object`.
- Otherwise → normalized `Item`, including the deleted/dead branches.

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *ok (story)* — recorded cassette `tests/cassettes/items.get.ok.json` for
  `item/8863.json` → assert one call
  `GET hacker-news.firebaseio.com /v0/item/8863.json`; output contains the title,
  `by`, `kids_count`, and `posted_at` as a `Date` (`2007-04-04T19:16:40Z`).
  (Existing `tests/cases/items.get.ok.json`.)
- *comment / poll / pollopt* — recorded cassettes for ids `2921983` (comment: asserts
  `parent`, `text`, no `title`), `126809` (poll: asserts `part_ids`,
  `descendants`), `160705` (pollopt: asserts `poll`, `score`).
- *not_found* — fixture returns `null` → `errorContains: "not_found"`. (Existing
  `tests/cases/items.get.missing.json`.)
- *bad id* — `id: -4` → `errorContains: "validation_error"`, `calls: []`.
  (Existing `tests/cases/items.get.bad-id.json`.)
- *upstream_error* — fixture status `500` → `errorContains: "upstream_error"`.
- *no-credentials* — host-call assertions check no `Authorization` header is sent.

**Implementation notes.** Trivial single fetch; shares `fetchJson` +
`normalizeItem` helpers (see [shared helpers](#shared-helpers)). `id` is
embedded in the path; reject non-integers before building the URL so a bad id
can never produce a host call.

---

### stories.list

**Purpose.** Compress "fetch a ranked feed, then resolve N ids into records" into
one bounded call. Covers the front page (`top`/`best`/`new`) and the category
feeds (`ask`/`show`/`job`) — use case #1 — and is a source set for client-side
analytics (#8).

**Use when** the agent wants the current ranked contents of a feed: top stories,
best stories, newest stories, latest Show HN / Ask HN / job posts.

**Do not use when** you want a single known id (`items.get`), a discussion
(`threads.get`), or the change feed (`updates.get`). Note the `top` feed mixes in
job posts (each tagged via `type`); filter client-side if you want stories only.
For the full body of an Ask HN post, call `items.get` on the story id — list
summaries omit `text` to stay bounded.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `kind` | `"top"\|"new"\|"best"\|"ask"\|"show"\|"job"` | `"top"` | Must be one of the six; else `validation_error`, no host calls. |
| `limit` | `number` | `10` | Integer `1..30`; else `validation_error`, no host calls. |
| `offset` | `number` | `0` | Integer `>= 0`; else `validation_error`, no host calls. Offset beyond the feed length yields an empty `stories` with `truncated: false`. |

Feed → endpoint: `top`→`topstories`, `new`→`newstories`, `best`→`beststories`,
`ask`→`askstories`, `show`→`showstories`, `job`→`jobstories`.

**Output.**

```ts
interface StoryListResult {
  kind: "top" | "new" | "best" | "ask" | "show" | "job";  // echoes input
  requested_limits: {
    limit: number;   // effective limit (after defaulting; 1..30)
    offset: number;  // effective offset (>= 0)
  };
  actual_counts: {
    feed_ids_available: number;       // ids the feed endpoint returned (the root list; not "items")
    ids_selected: number;             // ids in the offset..offset+limit slice (<= limit)
    stories_returned: number;         // hydrated records in `stories`
    skipped_deleted_or_dead: number;  // selected ids whose item was deleted/dead
    skipped_null: number;             // selected ids whose item body was null
    failed_fetch: number;             // selected ids whose item fetch returned non-2xx
  };
  truncated: boolean;                 // feed_ids_available > offset + ids_selected
  stories: StorySummary[];            // ranked order == the feed id-list order
}

interface StorySummary {
  id: number;          // required
  type: ItemType;      // required — disambiguates job vs story in mixed feeds
  title?: string;      // omitted if upstream omits
  url?: string;        // omitted (self/Ask posts have none); may be ""
  by?: string;         // omitted if absent
  score?: number;      // omitted if absent
  posted_at?: Date;    // native Date; omitted if no `time`
  comments: number;    // required — `descendants ?? 0`
}
```

- **Count invariant:** `ids_selected = stories_returned + skipped_deleted_or_dead
  + skipped_null + failed_fetch`. The single feed-list call is **not** counted in
  any of these (it is the root, not an item).
- **Ordering:** `stories` preserves feed rank (the id-list order) with skipped
  ids removed; never re-sorted.
- **Max items:** `stories.length <= limit <= 30`.
- **Omission:** deleted/dead/null/failed ids are absent from `stories` and
  recorded in the matching count bucket — never emitted as placeholders.
- **Summary is lean** by design: no `text`, `kids_count`, or linkage fields (use
  `items.get`/`threads.get` for those).

**Bounds and truncation.** Hard cap `limit <= 30` ⇒ at most `1 + 30 = 31` host
calls. `truncated` is `true` whenever ranked ids remain past `offset + limit`,
signalling the agent can page by raising `offset`.

**Upstream call plan and transformations.**

1. `GET /v0/{kind}stories.json` → array of ids; non-array body → `upstream_error`.
2. Slice `ids[offset : offset+limit]` → the selected ids.
3. For each selected id **in order**: `GET /v0/item/{id}.json`. Skip `null`
   (→`skipped_null`), `deleted`/`dead` (→`skipped_deleted_or_dead`); non-2xx →
   `failed_fetch` (skip, do not abort). Otherwise project to `StorySummary`
   (`time`→`posted_at`, `descendants ?? 0`→`comments`).
4. Assemble counts and `truncated = ids.length > offset + selected.length`.

**Branch and error behaviour.**

- Bad `kind` / `limit` / `offset` → `validation_error`, zero host calls.
- Feed list non-2xx or non-array → `upstream_error` (root failure; aborts).
- Empty feed or offset past end → `stories: []`, all counts 0, `truncated:
  false`. Not an error.
- Per-item failures are partial-result, never fatal (counted, see above).

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *ok (ordered, truncated)* — recorded cassette `tests/cassettes/stories.list.ok.json`,
  `kind:"top"`, `limit:2` → assert calls in exact order `topstories.json`, then
  the two selected `item/{id}.json` records (and **not** later ids); output
  contains both titles and `truncated: true`,
  `actual_counts.stories_returned: 2`. (Existing `tests/cases/stories.list.ok.json`.)
- *kind routing* — recorded cassettes for `kind:"new"`, `"best"`, `"ask"`,
  `"show"`, and `"job"` assert the call hits the corresponding feed endpoint;
  together with the `top` happy path, one case per kind confirms the six-way map.
- *offset paging* — feed of 5 ids, `offset:2, limit:2` asserts calls for the 3rd
  and 4th ids and `truncated: true`.
- *skips* — among selected ids, one returns `null`, one `{deleted:true}`, one a
  `500`; assert `stories_returned`, `skipped_null`, `skipped_deleted_or_dead`,
  `failed_fetch` each `=1` and the count invariant holds.
- *bad limit* — `limit:500` → `errorContains:"validation_error"`, `calls:[]`.
  (Existing `tests/cases/stories.list.bad-limit.json`.)
- *empty feed* — feed `[]` → `stories:[]`, one call (`topstories.json`),
  `truncated:false`.
- *no-credentials* — assert no auth header on any call.

**Implementation notes.** Sequential ordered hydration keeps host-call order
exactly assertable (an implementation may parallelise a level as long as output
order and the call *set* are preserved). Shares `fetchJson` + `normalizeItem`.
`top`/`job` feeds legitimately contain jobs — surface `type`, never silently
drop them.

---

### threads.get

**Purpose.** Reconstruct the discussion under an item as a **bounded** nested
comment tree: fetch the root item, then walk its `kids` recursively within a
depth and node budget. Covers the story + comment-thread report (use case #5).

**Use when** the agent wants the conversation under a story/Ask/poll (or any item
with replies) to summarise or analyse — not just the top-line counts.

**Do not use when** you only need the root's own fields (`items.get`) or the
total comment count (it is `descendants` on the root). Threads can be enormous;
this tool intentionally returns a *bounded sample*, not the entire tree.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `root_id` | `number` | — (required) | Integer `> 0`; else `validation_error`, no host calls. |
| `max_depth` | `number` | `3` | Integer `0..6` (root is depth 0; comments start at depth 1); else `validation_error`. |
| `max_nodes` | `number` | `50` | Integer `1..200` (total comment item fetch attempts, excluding root and including null/deleted/failed responses); else `validation_error`. |

**Output.**

```ts
interface ThreadResult {
  root: Item;          // canonical normalized Item for root_id
  requested_limits: {
    max_depth: number; // effective depth bound
    max_nodes: number; // effective node budget
  };
  actual_counts: {
    nodes_fetched: number;            // comment item fetch attempts made (excludes root; includes skipped/failed members)
    skipped_deleted_or_dead: number;  // comment ids whose item was deleted/dead (subtree pruned)
    skipped_null: number;             // comment ids whose body was null
    failed_fetch: number;             // comment fetches that returned non-2xx
    cycles_skipped: number;           // ids re-encountered via the visited guard (normally 0)
    max_depth_reached: number;        // deepest level actually materialised (0..max_depth)
  };
  truncated: boolean;  // true if the walk stopped with kids still unexpanded
  comments: Comment[]; // depth-1 comments in HN ranked order; each nests its replies
}

interface Comment {
  id: number;          // required
  by?: string;         // omitted on deleted comments
  posted_at?: Date;    // omitted if no `time`
  text?: string;       // raw HTML body; omitted if absent
  deleted: boolean;    // required
  dead: boolean;       // required
  depth: number;       // required — 1 for top-level, increasing with nesting
  kids_count: number;  // required — upstream direct-child count (may exceed replies.length when truncated)
  replies: Comment[];  // child comments actually fetched, HN ranked order; [] at the depth/node boundary
}
```

- **Count invariant:** `nodes_fetched = materialised comments +
  skipped_deleted_or_dead + skipped_null + failed_fetch`. The materialised
  comments are the nodes present in `comments` / `replies`. Cycle hits increment
  `cycles_skipped` before any comment fetch, so they do not consume
  `max_nodes`. The root fetch is **not** counted (it is the root, returned as
  `root`).
- **Ordering:** children appear in upstream `kids` order (HN ranked order) at
  every level. Traversal is breadth-first so the budget favours the
  highest-ranked comments across the tree rather than draining into one subtree.
- **Max fetches:** `nodes_fetched <= max_nodes <= 200`; nesting depth of
  materialised comments is `<= max_depth <= 6`.
- **Partial-result signal:** `truncated` is `true` if any node still had
  unexpanded `kids` when the depth bound or node budget was hit. At a node, a
  non-empty `kids_count` with a shorter `replies` array is the local truncation
  marker.

**Bounds and truncation.** Hard caps: `max_depth <= 6`, `max_nodes <= 200` ⇒ at
most `1 + 200 = 201` host calls. Lower `max_nodes` for latency; the result stays
correct, just smaller, with `truncated: true`. Null, deleted/dead, and failed
comment responses consume the same budget as successful comments, so the host
call ceiling is always `1 + max_nodes`. Cycles cannot inflate the budget: a
visited `Set` of ids guarantees each id is fetched at most once.

**Upstream call plan and transformations.**

1. `GET /v0/item/{root_id}.json` → root. `null` → `not_found`; non-2xx or
   malformed item object → `upstream_error`. Normalize to `Item`.
2. Seed a FIFO queue with the root's `kids` (depth 1), tracking depth per id and a
   visited `Set` seeded with `root_id`.
3. While the queue is non-empty **and** `nodes_fetched < max_nodes`: dequeue id;
   if already visited → `cycles_skipped`, continue; mark visited; increment
   `nodes_fetched`, then `GET /v0/item/{id}.json`. Classify:
   `null`→`skipped_null`; `deleted`/`dead`→`skipped_deleted_or_dead` (its subtree
   is **pruned** — not enqueued); non-2xx→`failed_fetch`. Otherwise build a
   `Comment`, attach under its parent, and — if `depth < max_depth` — enqueue its
   `kids` at `depth+1`.
4. `truncated` = the queue was non-empty when the loop stopped, **or** any
   retained node had `kids_count > 0` beyond `max_depth`.

**Branch and error behaviour.**

- Bad `root_id` / `max_depth` / `max_nodes` → `validation_error`, zero host calls.
- Root `null` → `not_found: no item with id {root_id}`.
- Root non-2xx or malformed item body → `upstream_error`.
- Root has no `kids` → `comments: []`, `nodes_fetched: 0`,
  `truncated: false`.
- `max_depth: 0` → fetch only the root and return `comments: []`,
  `nodes_fetched: 0`; `truncated` is `true` when the root has `kids` and
  `false` otherwise.
- Per-comment null/deleted/dead/non-2xx → counted, walk continues (partial
  result). A deleted/dead comment's subtree is pruned (documented limitation:
  live replies nested under a since-deleted parent are not returned — matches use
  case #5's "skip deleted/dead").

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *ok (nested, bounded)* — recorded cassette `tests/cassettes/threads.get.ok.json`
  for root `9224`, child `9272`, and grandchild `9479`, `max_depth:2`,
  `max_nodes:2` → assert BFS call order `item/9224`, `item/9272`, `item/9479`;
  output nests `9479` under `9272`, `nodes_fetched:2`,
  `truncated:false`.
- *node-budget truncation* — root with 5 kids, `max_nodes:2` → assert exactly
  `1 + 2 = 3` calls, `truncated:true`, and the two retained top-level comments
  have `kids_count` reflecting upstream while deeper kids are unfetched.
- *depth cap* — `max_depth:1` → asserts only depth-1 comments fetched; their
  `replies:[]` with positive `kids_count`; `truncated:true`.
- *empty thread* — fixture root `7` with no `kids`, `max_depth:3` → assert one
  call `GET hacker-news.firebaseio.com /v0/item/7.json`; output has
  `comments:[]`, `nodes_fetched:0`, `max_depth_reached:0`,
  `truncated:false`.
- *skips* — a kid returns `{deleted:true}` (subtree pruned, asserted not
  enqueued), another returns `null`, another `500` → assert the three skip/fail
  buckets, `nodes_fetched:3`, and that the walk continued.
- *node budget with skips* — first two kids are null/failed and `max_nodes:2` →
  assert only those two comment ids are fetched, the third kid is not fetched,
  and `truncated:true`.
- *root not_found* — root returns `null` → `errorContains:"not_found"`, one call.
- *bad bounds* — `max_nodes:9999` → `errorContains:"validation_error"`,
  `calls:[]`.
- *cycle guard* — a kid points back at the root id → `cycles_skipped:1`, no
  refetch of the root.
- *no-credentials* — assert no auth header on any call.

**Implementation notes.** Deterministic BFS dequeue order makes the host-call
sequence exactly assertable. Shares `fetchJson` + `normalizeItem`. The visited
`Set` is mandatory even though HN threads are acyclic in practice — it is the
documented cycle-handling guarantee and the only thing that bounds a malformed
tree. Keep traversal sequential in the contract; an implementation may fetch a
single BFS level concurrently provided per-level call sets and output ordering
are preserved.

---

### users.get

**Purpose.** Resolve a Hacker News user profile by username and, optionally,
hydrate a bounded sample from their `submitted` ids into items so the agent can
see *what* they post. Covers profiling a user (use case #6).

**Use when** the agent has a username (from a story/comment `by`, from
`updates.get` `profiles`, or supplied directly) and wants karma, account age,
bio, and/or a sample of submitted items.

**Do not use when** you have an item id rather than a username (`items.get`) or
want feed-wide activity (`stories.list`). The full `submitted` list (potentially
thousands of ids) is **never** returned — only its length and up to
`include_recent` hydrated records.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `username` | `string` | — (required) | Non-empty after trim (case-sensitive, sent verbatim); else `validation_error`, no host calls. |
| `include_recent` | `number` | `0` | Integer `0..30`; `0` = profile only (one host call); else `validation_error`. |

**Output.**

```ts
interface UserResult {
  id: string;            // required — the username (case-sensitive, as upstream returns)
  created_at: Date;      // required — account creation (native Date)
  karma: number;         // required
  about?: string;        // raw HTML bio; omitted if absent
  submitted_count: number; // required — length of upstream `submitted` (0 if none)
  requested_limits: {
    include_recent: number;  // effective hydration count (0..30)
  };
  actual_counts: {
    submissions_requested: number;    // min(include_recent, submitted_count)
    submissions_returned: number;     // hydrated records in `recent_submissions`
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
  };
  truncated: boolean; // submitted_count > submissions_requested
  recent_submissions: Item[];  // canonical Items in upstream `submitted` order; [] when include_recent = 0
}
```

- **Count invariant:** `submissions_requested = submissions_returned +
  skipped_deleted_or_dead + skipped_null + failed_fetch`. The profile fetch is
  **not** counted (it is the root). `submitted_count` reflects the **whole**
  upstream list even though at most `include_recent` ids are ever fetched.
- **Ordering:** `recent_submissions` follows upstream `submitted` array order.
  HN documents the field as the user's stories, polls, and comments, but does
  not document an ordering guarantee. The first `include_recent` ids are taken
  and hydrated in the order returned.
- **Max items:** `recent_submissions.length <= include_recent <= 30`.
- **Shape:** each entry is the full canonical [`Item`](#canonical-normalized-item)
  (so comment submissions carry `text`/`parent`, story submissions carry
  `title`/`url`).

**Bounds and truncation.** Hard cap `include_recent <= 30` ⇒ at most `1 + 30 =
31` host calls. `truncated` is `true` when `submitted_count >
actual_counts.submissions_requested`, including profile-only requests
(`include_recent: 0`) for users with submissions. Pagination strategy: the
Firebase user endpoint has no cursor or offset for `submitted`, so this tool
only exposes the first bounded window; callers may widen `include_recent` up to
30, then use specific known ids with `items.get` rather than paging this tool.
No recursion is performed.

**Upstream call plan and transformations.**

1. `GET /v0/user/{username}.json`. `null` → `not_found`; non-2xx or malformed
   profile object (missing/invalid `id`, `created`, `karma`, or `submitted` when
   present) → `upstream_error`. Map `created`→`created_at` (`Date`), copy
   `karma`, `about` (omit if absent), `submitted_count = (submitted?.length ??
   0)`.
2. If `include_recent > 0`: take `submitted.slice(0, include_recent)`; for each
   id **in order** `GET /v0/item/{id}.json`, classifying null/deleted-or-dead/
   non-2xx into the skip/fail buckets, else normalize to `Item`.

**Branch and error behaviour.**

- Empty/whitespace `username` or bad `include_recent` → `validation_error`, zero
  host calls.
- Profile `null` → `not_found: no user {username}`.
- Profile non-2xx or malformed profile body → `upstream_error`.
- User with no `submitted` (or `include_recent: 0`) → `recent_submissions: []`,
  hydration counts 0, one host call.
- Per-submission failures → counted, partial result (never fatal).

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *profile only* — recorded cassette `tests/cassettes/users.get.profile.json`,
  `username:"jl"`, default `include_recent:0` → assert exactly one call
  `user/jl.json`; output has `karma`, `created_at` as a `Date`,
  `submitted_count`, `truncated:true` when submitted ids exist, and
  `recent_submissions: []`.
- *with hydration, ordered* — recorded cassette
  `tests/cassettes/users.get.hydrate.json`, `username:"jl"`,
  `include_recent:2` → assert calls `user/jl.json`, then the first two
  submitted `item/{id}.json` records in order; `submissions_returned:2`,
  `truncated:true`.
- *case sensitivity* — `username:"JL"` and `"jl"` hit distinct paths
  `user/JL.json` vs `user/jl.json` (verbatim, no normalisation).
- *submission skips* — among hydrated ids one `null`, one `{dead:true}`, one
  `500` → assert the three buckets and the count invariant.
- *not_found* — profile `null` → `errorContains:"not_found"`, one call.
- *bad include_recent* — `include_recent:31` → `errorContains:"validation_error"`,
  `calls:[]`.
- *no-credentials* — assert no auth header on any call.

**Implementation notes.** Shares `fetchJson` + `normalizeItem`. Never return or
hydrate the full `submitted` array beyond the `slice(0, include_recent)` window
— that is the bound that keeps a thousand-submission account cheap. Sequential
hydration keeps call order assertable.

---

### updates.get

**Purpose.** Return Hacker News's change feed — the ids of recently changed items
and the usernames of recently changed profiles — so an agent can poll for change
and re-fetch only what moved, instead of rescanning whole feeds. Covers the
lightweight change-feed path in use case #7.

**Use when** running a monitor loop: call periodically, diff against the prior
result, then re-hydrate the changed ids/usernames with `items.get` / `users.get`.

**Do not use when** you want ranked/front-page content (`stories.list`) or
brand-new items in creation order (`items.recent`). This tool **does not**
hydrate — it relays a bounded ids/usernames snapshot cheaply in one call;
hydration is the agent's choice.

**Inputs.** None.

**Output.**

```ts
interface UpdatesResult {
  item_ids: number[];   // required — recently changed item ids, upstream order; [] if none
  profiles: string[];   // required — recently changed usernames, upstream order; [] if none
  requested_limits: {
    item_ids: number;   // fixed default and hard cap: 100
    profiles: number;   // fixed default and hard cap: 100
  };
  actual_counts: {
    item_ids: number;             // item_ids.length, <= 100
    profiles: number;             // profiles.length, <= 100
    item_ids_available: number;   // upstream items.length before slicing
    profiles_available: number;   // upstream profiles.length before slicing
  };
  truncated: boolean;   // item_ids_available > 100 || profiles_available > 100
}
```

- **Nullability:** both arrays are always present (possibly empty), never `null`.
- **Ordering:** exactly as the upstream `updates` payload returns them
  (no re-sort, no dedupe beyond what HN provides).
- **No hydration:** this is a single root read, not a fan-out tool. If the agent
  wants to hydrate returned ids/usernames, it calls `items.get`/`users.get`
  separately.

**Bounds and truncation.** Exactly one host call. Fixed defaults and hard caps:
`item_ids <= 100`, `profiles <= 100`; there are no caller inputs to widen them.
`truncated` is `true` when either upstream array was longer than its returned
window. `actual_counts.item_ids_available` and
`actual_counts.profiles_available` report the upstream window size before
slicing. Pagination strategy: Firebase exposes no cursor, offset, or stable page
for `/v0/updates.json`; callers poll again for later snapshots and should poll
more frequently if `truncated` is true. No recursion is possible.

**Upstream call plan and transformations.**

1. `GET /v0/updates.json` → `{ items, profiles }`.
2. Project `items`→`item_ids`, `profiles`→`profiles` (default each missing array
   to `[]`); slice each to its cap, compute `requested_limits`,
   `actual_counts`, and `truncated`. No per-item fetches.

**Branch and error behaviour.**

- Non-2xx or non-object body → `upstream_error`.
- Missing/empty `items` or `profiles` → corresponding `[]`, count `0`. Not an
  error.
- No `validation_error` path (no inputs); no `not_found` (the feed always exists).

**Effect rationale.** `@effect readOnly`, **not** `@idempotent`. Reading the feed
does not advance a cursor, consume an event, mark anything seen, or take a lease
(rules 6–7) — it is a snapshot read. It is not idempotent because the snapshot
changes on essentially every poll, so a prior result cannot substitute for a
refetch (rules 8–9).

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *ok* — recorded cassette `tests/cassettes/updates.get.ok.json` → assert one
  call `GET hacker-news.firebaseio.com /v0/updates.json`; output includes
  returned `item_ids` and `profiles` in upstream order,
  `requested_limits:{item_ids:100,profiles:100}`,
  matching returned/available counts, and `truncated:false` when the upstream
  arrays fit under the fixed caps.
- *empty arrays* — `{ "items":[], "profiles":[] }` → both `[]`, counts `0`.
- *missing keys* — `{}` → both default to `[]`, counts `0`.
- *upstream_error* — status `500` → `errorContains:"upstream_error"`.
- *no-credentials* — assert no auth header.

**Implementation notes.** Thinnest tool; one `fetchJson` + projection. Deliberately
no hydration so a polling loop stays cheap — the agent decides which changed ids
warrant an `items.get`/`users.get`.

---

### items.recent

**Purpose.** Discover the newest items on Hacker News **of any type** by reading
`maxitem` and walking item ids downward, hydrating up to `limit` live ones.
Covers the count-down discovery alternative in use case #7, and surfaces the
current `max_id` for agents that bookmark a position.

**Use when** the agent wants the raw "what was just created on HN" firehose
(brand-new comments and stories alike), or just the current max item id.

**Do not use when** you want newest *stories* specifically — most brand-new items
are comments, so use `stories.list(kind:"new")` for stories. For
change-monitoring of already-known content, `updates.get` is cheaper and more
targeted. This tool is a creation-order firehose, not a ranked feed.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `limit` | `number` | `10` | Integer `1..30`; else `validation_error`, no host calls. |

**Output.**

```ts
interface RecentItemsResult {
  max_id: number;        // required — the maxitem value observed this call
  requested_limits: {
    limit: number;       // effective limit (1..30)
  };
  actual_counts: {
    scan_budget: number;            // ids the walk may inspect = max(3, 2 * limit)
    ids_scanned: number;            // ids actually walked downward from max_id
    items_returned: number;         // hydrated live items in `items`
    skipped_deleted_or_dead: number;
    skipped_null: number;
    failed_fetch: number;
  };
  truncated: boolean;    // always true — older items always exist below the window (informational)
  items: Item[];         // up to `limit` canonical Items, newest-first (descending id)
}
```

- **Count invariant:** `ids_scanned = items_returned + skipped_deleted_or_dead +
  skipped_null + failed_fetch`. The `maxitem` lookup is **not** counted (it is the
  root). `ids_scanned <= scan_budget`.
- **Ordering:** strictly descending id (newest first).
- **Max items:** `items.length <= limit <= 30`.
- **`truncated` is always `true`** because `maxitem` only ever grows, so older
  items always exist beneath the returned window — it is informational. To tell
  whether the **request was satisfied**, compare `actual_counts.items_returned`
  with `requested_limits.limit`: equal ⇒ filled; fewer ⇒ the scan budget was
  exhausted by dead/deleted/missing ids before `limit` live items were found.

**Bounds and truncation.** Two bounds prevent runaway fan-out: the `limit` cap
(≤30 returned) and a `scan_budget = max(3, 2 * limit)` cap on how many ids the
walk may inspect (so a run of deleted ids cannot scan forever while a
single-item request can still skip two dead ids). Worst case `1 + 2·30 = 61`
host calls.

**Upstream call plan and transformations.**

1. `GET /v0/maxitem.json` → integer `max_id`. Non-2xx or non-integer →
   `upstream_error`.
2. Walk `id = max_id, max_id-1, …`; for each (until `items_returned == limit` or
   `ids_scanned == scan_budget`): `GET /v0/item/{id}.json`. Classify
   null/deleted-or-dead/non-2xx into the skip/fail buckets; else normalize to
   `Item` and append.
3. Assemble counts; `truncated = true`.

**Branch and error behaviour.**

- Bad `limit` → `validation_error`, zero host calls.
- `maxitem` non-2xx / non-integer → `upstream_error` (root failure; aborts before
  any item fetch).
- Scan budget exhausted before `limit` filled → partial `items`,
  `items_returned < limit`, counts explain why. Not an error.
- Per-item failures → counted, walk continues.

**Test grounding (recorded cassettes / fixtures + host-call assertions).**

- *ok* — recorded cassette `tests/cassettes/items.recent.ok.json`, `limit:2` →
  assert call order `maxitem.json`, then the two descending `item/{id}.json`
  records from that `maxitem` value; `items_returned:2`, `max_id` echoed, items
  in descending-id order.
- *skips within budget* — `maxitem` `100`, `item/100` `null`, `item/99`
  `{deleted:true}`, `item/98` live, `limit:1` → assert it scans 100→99→98,
  `items_returned:1`, `skipped_null:1`, `skipped_deleted_or_dead:1`.
- *scan-budget exhaustion* — `limit:1` (budget 3) with `item/100`, `item/99`,
  and `item/98` all `null` → assert exactly `1 + 3 = 4` calls,
  `items_returned:0`, `ids_scanned:3`, `items` empty.
- *maxitem upstream_error* — `maxitem` status `500` → `errorContains:
  "upstream_error"`, only the `maxitem.json` call made (no item fetches).
- *bad limit* — `limit:0` → `errorContains:"validation_error"`, `calls:[]`.
- *no-credentials* — assert no auth header.

**Implementation notes.** Shares `fetchJson` + `normalizeItem`. The `scan_budget =
max(3, 2 * limit)` heuristic keeps the call count bounded regardless of how many
recent ids are dead/deleted; document it so agents understand why
`items_returned` can be below `limit`. Sequential descending walk keeps host-call
order assertable.

---

### stories.search

**Purpose.** Search Hacker News stories through Algolia HN Search with bounded
result pages. Use relevance sort (`/api/v1/search`) for keyword/topic work and
date sort (`/api/v1/search_by_date`) for newest-first monitoring. Covers story
search by topic, author, date window, points, comments, and front-page / Ask HN /
Show HN tags (use case #2).

**Use when** the agent wants server-side search over stories, Ask HN posts, Show
HN posts, or current front-page stories. This is the right tool for "stories
about Rust", "recent Show HN posts by a user", "front-page stories", and
"high-comment-count stories since a date".

**Do not use when** you want the current HN ranked feeds without search
semantics (`stories.list`), one known item id (`items.get`), comments
(`comments.search`), or user profile lookup (`users.search` / `users.get`).
Algolia search hits are index records, not canonical Firebase item records; use
`items.get` for the canonical item shape.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `query` | `string` | omitted | Trimmed; empty string is omitted. |
| `sort` | `"relevance"\|"date"` | `"relevance"` | Else `validation_error`, no host calls. |
| `limit` | `number` | `10` | Integer `1..50`; sent as `hitsPerPage`; else `validation_error`. |
| `page` | `number` | `0` | Integer `>= 0`; else `validation_error`. |
| `scope` | `"story"\|"ask_hn"\|"show_hn"\|"front_page"` | `"story"` | Maps directly to the documented Algolia tag. |
| `author` | `string` | omitted | Letters, numbers, `_`, `-`; becomes `author_{username}`; else `validation_error`. |
| `since` / `until` | `Date` | omitted | Valid native `Date`; `since <= until`; converted to `created_at_i>=...` / `<=...` Unix seconds. |
| `min_points` | `number` | omitted | Non-negative integer; becomes `points>=...`. |
| `min_comments` | `number` | omitted | Non-negative integer; becomes `num_comments>=...`. |

**Output.**

```ts
interface AlgoliaSearchResult {
  sort: "relevance" | "date";  // required — echoes effective sort
  requested_limits: {
    limit: number;             // required — effective hitsPerPage, 1..50
    page: number;              // required — requested zero-based page, >= 0
  };
  requested_filters: {
    query?: string;            // omitted when absent/blank
    tags: string[];            // required — constructed Algolia tags, max 2 here
    numeric_filters: string[]; // required — constructed filters, max 4 here
    page: number;              // required — same value as requested_limits.page
    hits_per_page: number;     // required — same value as requested_limits.limit
  };
  actual_counts: {
    hits_returned: number;       // hits.length; <= requested_limits.limit
    nb_hits: number;             // upstream nbHits, or hits.length if omitted
    nb_pages: number;            // upstream nbPages, or 0 if omitted
    page: number;                // upstream page, or requested page if omitted
    hits_per_page: number;       // upstream hitsPerPage, or requested limit if omitted
    processing_time_ms?: number; // upstream processingTimeMS when numeric
  };
  truncated: boolean;          // actual_counts.page + 1 < actual_counts.nb_pages
  hits: AlgoliaSearchHit[];    // max requested_limits.limit; Algolia result order
}

interface AlgoliaSearchHit {
  object_id: string;       // required — upstream objectID (or id) as a string
  item_id?: number;        // numeric object_id when positive integer; omitted otherwise
  tags: string[];          // required — first 20 string values from `_tags`, or []
  author?: string;         // omitted if absent/non-string
  created_at?: Date;       // native Date from upstream `created_at`; omitted if absent/non-string
  updated_at?: Date;       // native Date from upstream `updated_at`; omitted if absent/non-string
  title?: string;          // story title; raw upstream text; omitted if absent/non-string
  url?: string;            // story URL; omitted if absent/non-string
  story_text?: string;     // Ask HN / text story body; omitted if absent/non-string
  comment_text?: string;   // present only if Algolia returns it; omitted for normal stories
  story_id?: number;       // upstream story_id; omitted if absent/non-number
  story_title?: string;    // upstream story_title; omitted if absent/non-string
  story_url?: string;      // upstream story_url; omitted if absent/non-string
  parent_id?: number;      // comment parent id if returned; omitted for stories
  points?: number;         // omitted when upstream returns null or omits
  num_comments?: number;   // story comment count; omitted if absent/non-number
}
```

Nullability and omission: optional fields are omitted, never returned as `null`;
Algolia `points: null` is therefore omitted. `hits` is always present and may be
empty. `children`, `_highlightResult`, `processingTimingsMS`, `params`,
`serverTimeMS`, and `exhaustive*` metadata are intentionally omitted; probes show
`children` can be large and highlight metadata is UI-oriented. `requested_limits`
is the stable bounded/pagination accounting object; `requested_filters.page` and
`requested_filters.hits_per_page` are kept as existing request echoes for
compatibility. `actual_counts` reports the page metadata Algolia returned. There
is no per-hit failure branch because Algolia returns each page atomically.

**Bounds and truncation behaviour.** Hard cap `limit <= 50`; exactly one host
call. `page` is zero-based because probes returned `page: 0` for default first
page. `truncated: true` means additional Algolia pages exist; the agent pages by
calling again with `page + 1`. Empty searches return `hits: []`, `nb_hits: 0`,
`nb_pages: 0`, `truncated: false`.

**Upstream call plan and transformations.**

1. Build tags: `[scope]`, plus `author_{author}` when supplied.
2. Build numeric filters from valid inputs: `created_at_i>=floor(since/1000)`,
   `created_at_i<=floor(until/1000)`, `points>=min_points`, and
   `num_comments>=min_comments`.
3. Choose endpoint: `sort:"relevance"` → `GET /api/v1/search`; `sort:"date"` →
   `GET /api/v1/search_by_date`.
4. Send `query` only when non-empty, always send `tags`, `page`, and
   `hitsPerPage`, and send `numericFilters` only when at least one filter exists.
   No headers, body, credentials, or retries.
5. Normalize each hit to `AlgoliaSearchHit`: `objectID`→`object_id`,
   parse positive numeric object ids into `item_id`, convert timestamp strings to
   `Date`, copy stable scalar fields, drop large/UI-only arrays and objects.

**Branch and error behaviour.**

- Bad `sort`, `limit`, `page`, `scope`, `author`, `since`/`until`,
  `min_points`, or `min_comments` → `validation_error`, zero host calls.
- Algolia non-2xx (including the probed 400 numeric-filter envelope), non-JSON
  body, missing result object, or missing `hits` array → `upstream_error`.
- Empty search page (`hits: []`) → successful result, not `not_found`.
- `page` beyond Algolia's available pages is not prevalidated because `nbPages`
  is only known after the call; the returned page metadata and empty `hits`
  describe the outcome.

**Fixture/mock/live-test grounding.**

- *happy relevance search* — `tests/cases/stories.search.ok.json`: recorded
  cassette for `hn.algolia.com/api/v1/search`, asserts one `GET`, no Authorization,
  and output fields including `object_id`, tags, `hits_returned`, and native
  `Date`.
- *date-sort search* — `tests/cases/stories.search.date.json`: recorded cassette asserts
  `/api/v1/search_by_date`, `sort:"date"`, first-page metadata, and a dated hit.
- *empty results* — `tests/cases/stories.search.empty.json`: recorded cassette with `hits: []`,
  `nbHits:0`, `nbPages:0`; asserts success with zero hits.
- *validation error* — `tests/cases/stories.search.bad-limit.json`: invalid
  `limit` fails before any call.
- *upstream error* — `tests/cases/stories.search.upstream.json`: mocked Algolia
  500 maps to `upstream_error` because injected upstream faults cannot be
  recorded reliably.
- Probe grounding: `docs/probes/algolia-search-stories.json`,
  `docs/probes/algolia-search-by-date-stories.json`,
  `docs/probes/algolia-search-author-pg.json`,
  `docs/probes/algolia-search-empty.json`, and
  `docs/probes/algolia-search-bad-filter.json`.

**Implementation notes.** Shared `searchAlgolia` handles endpoint selection,
URL encoding, error mapping, pagination accounting, and hit normalization.
`stories.search.ts` should stay thin: validate/default inputs, construct tags
and numeric filters, then call the helper. Do not hydrate Algolia hits through
Firebase inside this tool; that would turn a one-call search page into hidden
fan-out and change the failure model.

---

### comments.search

**Purpose.** Search Hacker News comments through Algolia HN Search. This covers
comment keyword searches, comments by author, comments under a story, and comment
time windows (use case #3).

**Use when** the agent wants matching comments across HN, comments by an author,
comments under a known story id, or recent comments in a time window.

**Do not use when** you need the whole discussion tree under a story
(`threads.get`) or the canonical Firebase shape for a known comment id
(`items.get`). Algolia comment hits are search index records; they omit nested
reply expansion and may carry story linkage fields from the index.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `query` | `string` | omitted | Trimmed; empty string is omitted. |
| `sort` | `"relevance"\|"date"` | `"relevance"` | Else `validation_error`, no host calls. |
| `limit` | `number` | `10` | Integer `1..50`; sent as `hitsPerPage`; else `validation_error`. |
| `page` | `number` | `0` | Integer `>= 0`; else `validation_error`. |
| `author` | `string` | omitted | Letters, numbers, `_`, `-`; becomes `author_{username}`; else `validation_error`. |
| `story_id` | `number` | omitted | Positive integer; becomes `story_{id}`; else `validation_error`. |
| `since` / `until` | `Date` | omitted | Valid native `Date`; `since <= until`; converted to `created_at_i>=...` / `<=...` Unix seconds. |

**Output.**

```ts
interface AlgoliaSearchResult {
  sort: "relevance" | "date";  // required — echoes effective sort
  requested_limits: {
    limit: number;             // required — effective hitsPerPage, 1..50
    page: number;              // required — requested zero-based page, >= 0
  };
  requested_filters: {
    query?: string;            // omitted when absent/blank
    tags: string[];            // required — starts with "comment", max 3 here
    numeric_filters: string[]; // required — constructed filters, max 2 here
    page: number;              // required — same value as requested_limits.page
    hits_per_page: number;     // required — same value as requested_limits.limit
  };
  actual_counts: {
    hits_returned: number;       // hits.length; <= requested_limits.limit
    nb_hits: number;             // upstream nbHits, or hits.length if omitted
    nb_pages: number;            // upstream nbPages, or 0 if omitted
    page: number;                // upstream page, or requested page if omitted
    hits_per_page: number;       // upstream hitsPerPage, or requested limit if omitted
    processing_time_ms?: number; // upstream processingTimeMS when numeric
  };
  truncated: boolean;          // actual_counts.page + 1 < actual_counts.nb_pages
  hits: AlgoliaSearchHit[];    // max requested_limits.limit; Algolia result order
}

interface AlgoliaSearchHit {
  object_id: string;       // required — upstream objectID (or id) as a string
  item_id?: number;        // numeric object_id when positive integer; omitted otherwise
  tags: string[];          // required — first 20 string values from `_tags`, or []
  author?: string;         // omitted if absent/non-string
  created_at?: Date;       // native Date from upstream `created_at`; omitted if absent/non-string
  updated_at?: Date;       // native Date from upstream `updated_at`; omitted if absent/non-string
  title?: string;          // rarely present on comment hits; omitted if absent/non-string
  url?: string;            // rarely present on comment hits; omitted if absent/non-string
  story_text?: string;     // omitted if absent/non-string
  comment_text?: string;   // raw indexed comment text; omitted if absent/non-string
  story_id?: number;       // linked story id; omitted if absent/non-number
  story_title?: string;    // linked story title; omitted if absent/non-string
  story_url?: string;      // linked story URL; omitted if absent/non-string
  parent_id?: number;      // parent item id; omitted if absent/non-number
  points?: number;         // omitted when upstream returns null or omits
  num_comments?: number;   // omitted if absent/non-number
}
```

Nullability and omission match `stories.search`: optional fields are omitted,
never returned as `null`; `hits` is always present and may be empty. `children`,
`_highlightResult`, and other UI-only Algolia metadata are omitted. The most
common comment hit fields observed in probes are `comment_text`, `story_id`,
`story_title`, `story_url`, and `parent_id`. `requested_limits` is the stable
bounded/pagination accounting object; `requested_filters.page` and
`requested_filters.hits_per_page` are retained request echoes for compatibility.

**Bounds and truncation behaviour.** Hard cap `limit <= 50`; exactly one host
call. Pagination is the same zero-based Algolia page contract as
`stories.search`. `truncated` is true when more result pages exist; empty result
pages are successful with `hits: []`.

**Upstream call plan and transformations.**

1. Build tags: `["comment"]`, plus `author_{author}` and/or `story_{story_id}`
   when supplied. Algolia ANDs these tags, matching the documented
   `comment,story_X` and `author_USERNAME` search forms.
2. Build numeric filters only from the optional `Date` window:
   `created_at_i>=floor(since/1000)` and
   `created_at_i<=floor(until/1000)`.
3. Choose endpoint by `sort` exactly as `stories.search`.
4. Send `query` only when non-empty, always send `tags`, `page`, and
   `hitsPerPage`, and send `numericFilters` only when at least one date filter
   exists. No headers, body, credentials, or retries.
5. Normalize hits through the shared `AlgoliaSearchHit` projection.

**Branch and error behaviour.**

- Bad `sort`, `limit`, `page`, `author`, `story_id`, or `since`/`until` →
  `validation_error`, zero host calls.
- Algolia non-2xx (including the probed 400 error envelope), non-JSON body,
  missing result object, or missing `hits` array → `upstream_error`.
- Empty search page (`hits: []`) → successful result, not `not_found`.
- A comment hit with `points: null` or absent optional fields still succeeds;
  those optional fields are omitted in the normalized hit.

**Fixture/mock/live-test grounding.**

- *happy scoped search* — `tests/cases/comments.search.ok.json`: recorded
  cassette for `hn.algolia.com/api/v1/search`, uses `tags=comment,story_9998227`, asserts one
  unauthenticated `GET`, `object_id`, `story_id`, comment text, and native
  `Date`.
- *empty results* — `tests/cases/comments.search.empty.json`: recorded cassette with `hits: []`,
  `nbHits:0`, `nbPages:0`; asserts success with zero hits.
- *validation error* — `tests/cases/comments.search.bad-story-id.json`: invalid
  `story_id` fails before any host call.
- *upstream error* — `tests/cases/comments.search.upstream.json`: mocked Algolia
  400 maps to `upstream_error` because injected upstream faults cannot be
  recorded reliably.
- Probe grounding: `docs/probes/algolia-search-comments.json`,
  `docs/probes/algolia-search-empty.json`, and
  `docs/probes/algolia-search-bad-filter.json`.

**Implementation notes.** Shares `searchAlgolia`, so pagination accounting,
error handling, and hit normalization stay identical to `stories.search`. Do not
turn `story_id` into a Firebase fetch; Algolia's documented `story_` tag is the
server-side filter and keeps the tool one-call and testable.

---

### users.search

**Purpose.** Resolve an Algolia HN Search user profile by exact username. The
Algolia docs do not offer full-text user search; `users.search` is named for the
Algolia search surface but performs exact lookup through `/api/v1/users/{username}`.

**Use when** the agent specifically wants Algolia's exact user profile shape
(`username`, `karma`, optional `about`) or wants to verify that the public
Algolia HN Search user endpoint resolves a username.

**Do not use when** you need Firebase user fields such as `created_at`,
`submitted_count`, or hydrated recent submissions (`users.get`). Do not use it
for fuzzy/full-text user search; the research found no documented Algolia API
for that capability.

**Inputs.**

| Name | Type | Default | Validation |
|------|------|---------|------------|
| `username` | `string` | — (required) | Non-empty after trim; sent verbatim as one URL-encoded path segment; else `validation_error`, no host calls. |

**Output.**

```ts
interface AlgoliaUserResult {
  username: string; // required — exact username returned by Algolia
  karma: number;    // required — upstream karma when numeric, else 0
  about?: string;   // optional raw HTML/text bio; omitted if absent/non-string
}
```

Nullability: optional `about` is omitted, never `null`. This is a single root
lookup, not fan-out or pagination, so it has no `requested_limits`,
`actual_counts`, or `truncated`. The Firebase `users.get` schema is intentionally
different because the two upstream APIs return different fields.

**Bounds and truncation behaviour.** Exactly one host call and no pagination.
There is no full-text user result list to bound; unsupported fuzzy search is
explicitly out of scope.

**Upstream call plan and transformations.**

1. Validate `username` locally.
2. `GET /api/v1/users/{encodeURIComponent(username)}`.
3. Require a JSON object with a string `username`; copy `karma` when numeric
   else default `0`; copy `about` only when a string. No headers, body,
   credentials, or retries.

**Branch and error behaviour.**

- Blank/non-string `username` → `validation_error`, zero host calls.
- Algolia non-2xx (including missing-user 404 if returned), non-JSON body,
  non-object body, or response object without string `username` →
  `upstream_error`.
- There is no `not_found` code for this tool because probes only established
  Algolia 404-style envelopes for missing items, and the user endpoint research
  did not establish a stable missing-user contract. Treat non-2xx as upstream
  failure rather than inventing an empty user-search result.

**Fixture/mock/live-test grounding.**

- *happy exact lookup* — `tests/cases/users.search.ok.json`: recorded cassette
  for `hn.algolia.com/api/v1/users/pg`, asserts one unauthenticated `GET`, and
  returns `username`, `about`, and `karma` matching
  `docs/probes/algolia-user-pg.json`.
- *validation error* — `tests/cases/users.search.bad-username.json`: blank
  username fails with zero calls.
- *upstream error* — `tests/cases/users.search.upstream.json`: mocked Algolia
  500 maps to `upstream_error` because injected upstream faults cannot be
  recorded reliably.
- Probe grounding: `docs/probes/algolia-user-pg.json`.

**Implementation notes.** Keep this as exact lookup despite the `.search` method
name; platform file names require a single-segment resource, and `users.search`
groups the Algolia user surface with the other Algolia-backed tools. Do not add
synthetic user search by scanning story/comment authors; that would be
unbounded, incomplete, and not documented by the service.

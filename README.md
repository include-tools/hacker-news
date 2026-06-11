# hacker-news

A [toolbox](https://github.com/solidarity-ai/toolbox) tool package wrapping the
official read-only Hacker News Firebase API
(`https://hacker-news.firebaseio.com/v0/`, **no authentication**). Produced by
toolfactory4. The full design rationale lives in [`docs/toolset.md`](docs/toolset.md).

The upstream is a low-level identity store: every feed is a bare array of item
ids and every item must be fetched one id at a time. These tools provide
**fan-out compression with explicit bounds** — one call resolves a
feed-of-ids-plus-N-item-fetches into a single normalized, capped, observable
result.

## Conventions shared by every tool

- **Read-only.** Every tool is `@effect readOnly`; none is `@idempotent` (HN data
  is live and mutable, so re-call to refresh — an earlier result is never reused).
- **One host.** All traffic goes to `hacker-news.firebaseio.com` over `GET`. No
  auth headers or credential params are ever sent (the API accepts none).
- **Native timestamps.** Unix-seconds (`time`, `created`) are returned as native
  `Date` objects (`posted_at`, `created_at`), never epoch integers or strings.
- **Raw HTML passthrough.** `title`, `text`, `about`, and `url` are returned
  exactly as HN provides them (HTML markup/entities **not** decoded). Strip or
  escape on the agent side before display.
- **Omitted, never null.** Optional fields are absent from the object when the
  upstream omits them; they are never `null`. The empty-string `url` jobs
  sometimes carry is preserved as `""` (distinct from omitted).
- **Bounded fan-out + accounting.** Every tool that hydrates ids takes an explicit
  bounded `limit`/budget, validates it, and reports what happened via
  `requested_limits` (effective bounds) and `actual_counts` (returned + each
  skip/fail bucket). A missing/deleted/dead member or a per-item HTTP failure is
  **skipped and tallied**, never fatal.
- **Errors.** Tools throw `Error` with a prefixed message:
  - `validation_error: …` — bad input, detected **before any** host call (zero
    requests made).
  - `not_found: …` — a directly-requested **root** item/user returned JSON `null`.
  - `upstream_error: …` — a root request returned non-2xx, a non-JSON body, or an
    unexpected shape.

### Canonical normalized `Item`

`items.get`, `threads.get`'s `root`, each `users.get` `recent_submissions`
entry, and each `items.recent` `items` entry share one shape:

`{ id, type, by?, posted_at?, title?, url?, text?, score?, descendants?,
kids_count, parent?, poll?, part_ids?, deleted, dead }`

`type` is one of `story | comment | job | poll | pollopt | unknown`. `id`,
`type`, `kids_count`, `deleted`, `dead` are always present. The raw `kids` array
is **never** returned (only `kids_count`); walk threads with `threads.get`.

## Tools

### `items.get(id)`

Resolve a single item of any type by numeric id.

- `id` — integer `> 0` (required).
- Returns the canonical `Item`. `deleted`/`dead` items are **returned** with
  their flags set (the caller asked for that id), not skipped.
- Single fetch — no `requested_limits`/`actual_counts`/`truncated`.
- Errors: `validation_error` (bad id), `not_found` (JSON `null`), `upstream_error`.

### `stories.list(kind?, limit?, offset?)`

List a ranked feed (front page or category) as bounded story summaries.

- `kind` — `"top"` (default) `| "new" | "best" | "ask" | "show" | "job"`.
- `limit` — default `10`, integer `1..30` (hard max 30 ⇒ ≤ `1 + 30` host calls).
- `offset` — default `0`, integer `>= 0` (client-side paging into the ranked ids).
- Returns `{ kind, requested_limits:{limit,offset}, actual_counts:{feed_ids_available,
  ids_selected, stories_returned, skipped_deleted_or_dead, skipped_null,
  failed_fetch}, truncated, stories[] }`.
- Each `StorySummary` is `{ id, type, title?, url?, by?, score?, posted_at?,
  comments }` (`comments = descendants ?? 0`). Summaries are lean — no `text`;
  use `items.get` for an Ask HN body. The `top`/`job` feeds mix in job posts
  (tagged via `type`).
- Count invariant: `ids_selected = stories_returned + skipped_deleted_or_dead +
  skipped_null + failed_fetch`. `truncated` is true when ranked ids remain past
  `offset + limit`.
- Errors: `validation_error` (bad kind/limit/offset), `upstream_error` (feed not
  an array / non-2xx). Empty feed or offset past end ⇒ `stories: []`, not an error.

### `threads.get(root_id, max_depth?, max_nodes?)`

Reconstruct the discussion under an item as a bounded nested comment tree
(breadth-first within a depth + node budget).

- `root_id` — integer `> 0` (required).
- `max_depth` — default `3`, integer `0..6` (root is depth 0; comments start at 1).
- `max_nodes` — default `50`, integer `1..200` (total comments fetched, excludes
  root ⇒ ≤ `1 + 200` host calls).
- Returns `{ root:Item, requested_limits:{max_depth,max_nodes},
  actual_counts:{nodes_fetched, skipped_deleted_or_dead, skipped_null,
  failed_fetch, cycles_skipped, max_depth_reached}, truncated, comments[] }`.
- Each `Comment` is `{ id, by?, posted_at?, text?, deleted, dead, depth,
  kids_count, replies[] }`; `replies` nests child comments in HN ranked order and
  is `[]` at the depth/node boundary. A non-empty `kids_count` with a shorter
  `replies` is the local truncation marker.
- Deleted/dead comments are skipped and their subtree pruned. A visited set makes
  each id fetched at most once (cycle guard → `cycles_skipped`).
- `truncated` is true if the walk stopped with kids still unexpanded.
- Errors: `validation_error` (bad bounds), `not_found` (root `null`),
  `upstream_error` (root non-2xx).

### `users.get(username, include_recent?)`

Resolve a user profile by (case-sensitive) username and optionally hydrate their
most-recent submissions.

- `username` — non-empty string, sent verbatim/case-sensitive (required).
- `include_recent` — default `0` (profile only, one call), integer `0..30`
  (⇒ ≤ `1 + 30` host calls).
- Returns `{ id, created_at:Date, karma, about?, submitted_count,
  requested_limits:{include_recent}, actual_counts:{submissions_requested,
  submissions_returned, skipped_deleted_or_dead, skipped_null, failed_fetch},
  recent_submissions:Item[] }`.
- The full `submitted` list (can be thousands of ids) is **never** returned — only
  its length (`submitted_count`) and the first `include_recent` hydrated records
  (newest-first). `submitted_count - submissions_requested` is how many more exist.
- Errors: `validation_error` (empty username / bad include_recent), `not_found`
  (profile `null`), `upstream_error`.

### `updates.get()`

Return HN's change feed for polling loops (no hydration, one call).

- No parameters.
- Returns `{ item_ids:number[], profiles:string[],
  actual_counts:{item_ids, profiles} }` in upstream order; both arrays always
  present (possibly empty). Not capped — slice client-side before hydrating with
  `items.get`/`users.get`. Reading does **not** advance any cursor.
- Errors: `upstream_error` (non-2xx / non-object body). No validation or
  not_found path.

### `items.recent(limit?)`

Discover the newest items of any type by reading `maxitem` and walking ids
downward, hydrating up to `limit` live ones.

- `limit` — default `10`, integer `1..30`.
- Returns `{ max_id, requested_limits:{limit}, actual_counts:{scan_budget,
  ids_scanned, items_returned, skipped_deleted_or_dead, skipped_null,
  failed_fetch}, truncated, items:Item[] }` in strictly descending id order.
- `scan_budget = 2 * limit` bounds how many ids the walk may inspect (⇒ ≤
  `1 + 2·30 = 61` host calls), so a run of dead/deleted ids cannot scan forever.
  `items_returned < limit` means the budget was exhausted before `limit` live
  items were found. `truncated` is always `true` (older items always exist below).
- Most brand-new items are comments — for newest *stories* use
  `stories.list("new")`.
- Errors: `validation_error` (bad limit), `upstream_error` (`maxitem` non-2xx or
  non-integer, before any item fetch).

## Development

```
npm install
npm run typecheck
```

Declarative fixture tests live in `tests/cases/*.json`; the factory harness runs
them against the real toolbox runtime with a mocked fetch transport. Logic common
to every tool (the single fetch primitive, item normalisation, the error
constructor, and the skip/fail accounting) lives in `lib/hn.ts`, included via
`additionalTypeScriptGlobs` in `toolbox.devpkg.json`.

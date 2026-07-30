# hacker-news

**Know what Hacker News is saying without wiring the APIs yourself.** Use it for
front-page digests, Algolia-powered story and comment search, Show HN trackers,
comment-thread summaries, user profiles, and live change monitoring.

## What your agent can do with it

| Ask | Tool |
|---|---|
| "What's on the front page right now?" | `stories.list` |
| "Find the newest HN stories about WebAssembly." | `stories.search` |
| "Find comments mentioning this bug under a specific story." | `comments.search` |
| "Give me today's Show HN, Ask HN, or jobs feed." | `stories.list` (`kind: "show" / "ask" / "job"`) |
| "Summarize the discussion under this post" | `threads.get` — bounded comment-tree walk |
| "Who is this user and what do they post about?" | `users.get` |
| "Verify this username in Algolia's index." | `users.search` |
| "What new items appeared since the latest known id?" | `items.recent` |
| "Which HN items or profiles changed recently?" | `updates.get` |
| "Resolve this HN item id." | `items.get` |

The raw Firebase API is a bare id store: every feed is an array of ids, every
item is its own fetch, and full threads require recursive child lookups. These
tools choose the right API, hydrate or search the useful slice, cap expansion,
and return accounting in one call so an agent can work with HN content instead
of choreographing endpoint calls.

## Quickstart

```sh
toolbox install github.com/include-tools/hacker-news@v0.2.0
```

## Common contract

The package is unauthenticated and read-only, allows only
`hacker-news.firebaseio.com` and `hn.algolia.com`, returns native `Date`
timestamps, and passes text/title/about fields through as raw upstream HTML.

Canonical item fields returned by `items.get`, `threads.get.root`,
`users.get.recent_submissions`, and `items.recent.items` are:
`id`, `type`, `by`, `posted_at`, `title`, `url`, `text`, `score`,
`descendants`, `kids_count`, `parent`, `poll`, `part_ids`, `deleted`, and
`dead`. Optional upstream fields are omitted when absent.

Fan-out tools report `requested_limits`, `actual_counts`, and `truncated`.
Deleted, dead, null, or failed member fetches are counted in
`skipped_deleted_or_dead`, `skipped_null`, or `failed_fetch` instead of returned
as placeholder records.

Error modes use `"<code>: <detail>"` messages:

| Code | Meaning |
|---|---|
| `validation_error` | Bad caller input. Raised before any host call, so expected upstream calls are `[]`. |
| `not_found` | Directly requested Firebase item or user returned JSON `null`. |
| `upstream_error` | Root request returned non-2xx, non-JSON, or an unexpected shape such as a feed that is not an array or an item/user object missing required fields. Per-member fan-out failures are counted instead. |

## Tool reference

### `items.get`

Resolve one HN item by id.

| Parameter | Default | Bounds |
|---|---|---|
| `id` | required | Positive integer. |

Output: one canonical item. No `requested_limits`, `actual_counts`, or
`truncated`.

Errors: `validation_error` for bad `id`, `not_found` for `null`, and
`upstream_error` for root fetch failure or a malformed item object.

### `stories.list`

List a ranked Firebase feed and hydrate a bounded slice into lean summaries.

| Parameter | Default | Bounds |
|---|---|---|
| `kind` | `"top"` | One of `"top"`, `"new"`, `"best"`, `"ask"`, `"show"`, `"job"`. |
| `limit` | `10` | Integer `1..30`. |
| `offset` | `0` | Non-negative integer. |

Output fields: `kind`, `requested_limits { limit, offset }`,
`actual_counts { feed_ids_available, ids_selected, stories_returned,
skipped_deleted_or_dead, skipped_null, failed_fetch }`, `truncated`, and
`stories`. Each story has `id`, `type`, `title`, `url`, `by`, `score`,
`posted_at`, and `comments`.

Errors: `validation_error` for bad input and `upstream_error` when the feed root
does not return an array. Empty feeds and per-item failures are successful
partial results.

### `threads.get`

Fetch a root item and walk its comment tree breadth-first within depth and fetch
budgets.

| Parameter | Default | Bounds |
|---|---|---|
| `root_id` | required | Positive integer. |
| `max_depth` | `3` | Integer `0..6`; root is depth 0. |
| `max_nodes` | `50` | Integer `1..200`; comment fetch attempts excluding root, including null/deleted/failed responses. |

Output fields: `root`, `requested_limits { max_depth, max_nodes }`,
`actual_counts { nodes_fetched, skipped_deleted_or_dead, skipped_null,
failed_fetch, cycles_skipped, max_depth_reached }`, `truncated`, and
`comments`. Each comment has `id`, `by`, `posted_at`, `text`, `deleted`, `dead`,
`depth`, `kids_count`, and `replies`.

Errors: `validation_error` for bad bounds, `not_found` for a missing root, and
`upstream_error` for root fetch failure or a malformed root item object.
Per-comment failures are counted.

### `users.get`

Resolve a Firebase user profile and optionally hydrate a bounded sample of
submitted item ids.

| Parameter | Default | Bounds |
|---|---|---|
| `username` | required | Non-empty string after trim; sent verbatim and case-sensitive. |
| `include_recent` | `0` | Integer `0..30`. |

Output fields: `id`, `created_at`, `karma`, `about`, `submitted_count`,
`requested_limits { include_recent }`, `actual_counts {
submissions_requested, submissions_returned, skipped_deleted_or_dead,
skipped_null, failed_fetch }`, `truncated`, and `recent_submissions` canonical
items.

Errors: `validation_error` for bad input, `not_found` for a missing profile, and
`upstream_error` for profile fetch failure or a malformed profile object.
Per-submission failures are counted.

### `updates.get`

Return HN's changed item ids and profile usernames without hydration.

Parameters: none.

Output fields: `item_ids`, `profiles`, `requested_limits { item_ids: 100,
profiles: 100 }`, `actual_counts { item_ids, profiles, item_ids_available,
profiles_available }`, and `truncated`.

Errors: only `upstream_error` for a failed or non-object root response. Missing
`items` or `profiles` keys default to empty arrays.

### `items.recent`

Read `maxitem` and walk downward to return the newest live items of any type.

| Parameter | Default | Bounds |
|---|---|---|
| `limit` | `10` | Integer `1..30`; scan budget is `max(3, 2 * limit)` item fetches. |

Output fields: `max_id`, `requested_limits { limit }`, `actual_counts {
scan_budget, ids_scanned, items_returned, skipped_deleted_or_dead,
skipped_null, failed_fetch }`, `truncated`, and `items` canonical items in
descending id order. `truncated` is always `true` because older ids always exist
below the returned window.

Errors: `validation_error` for bad `limit` and `upstream_error` if `maxitem`
fails or is not an integer. Per-item failures are counted.

### `stories.search`

Search Algolia HN story records by relevance or date.

| Parameter | Default | Bounds |
|---|---|---|
| `query` | omitted | String; blank trims to omitted. |
| `sort` | `"relevance"` | `"relevance"` or `"date"`. |
| `limit` | `10` | Integer `1..50`. |
| `page` | `0` | Non-negative integer. |
| `scope` | `"story"` | `"story"`, `"ask_hn"`, `"show_hn"`, or `"front_page"`. |
| `author` | omitted | Letters, numbers, underscores, or hyphens. |
| `since` | omitted | Valid `Date`; adds `created_at_i>=...`. |
| `until` | omitted | Valid `Date`; adds `created_at_i<=...`; must be `>= since`. |
| `min_points` | omitted | Non-negative integer. |
| `min_comments` | omitted | Non-negative integer. |

Output fields: `sort`, `requested_limits { limit, page }`,
`requested_filters { query, tags, numeric_filters, page, hits_per_page }`,
`actual_counts { hits_returned, nb_hits, nb_pages, page, hits_per_page,
processing_time_ms }`, `truncated`, and `hits`.

Search hit fields: `object_id`, `item_id`, `tags`, `author`, `created_at`,
`updated_at`, `title`, `url`, `story_text`, `comment_text`, `story_id`,
`story_title`, `story_url`, `parent_id`, `points`, and `num_comments`.

Errors: `validation_error` for bad parameters and `upstream_error` for failed,
non-JSON, or malformed Algolia responses. Empty pages are successful results.

### `comments.search`

Search Algolia HN comment records.

| Parameter | Default | Bounds |
|---|---|---|
| `query` | omitted | String; blank trims to omitted. |
| `sort` | `"relevance"` | `"relevance"` or `"date"`. |
| `limit` | `10` | Integer `1..50`. |
| `page` | `0` | Non-negative integer. |
| `author` | omitted | Letters, numbers, underscores, or hyphens. |
| `story_id` | omitted | Positive integer. |
| `since` | omitted | Valid `Date`. |
| `until` | omitted | Valid `Date`; must be `>= since`. |

Output fields match `stories.search`: `sort`, `requested_limits`,
`requested_filters`, `actual_counts`, `truncated`, and `hits` with the search hit
fields listed above.

Errors: `validation_error` for bad parameters and `upstream_error` for failed,
non-JSON, or malformed Algolia responses. Empty pages are successful results.

### `users.search`

Resolve an exact Algolia user profile.

| Parameter | Default | Bounds |
|---|---|---|
| `username` | required | Non-empty string after trim; URL-encoded as one path segment. |

Output fields: `username`, `karma`, and optional `about`.

Errors: `validation_error` for a blank/non-string username and `upstream_error`
for failed, non-object, or malformed Algolia responses. This tool has no
`not_found` mode.

The full contract is in [`docs/toolset.md`](docs/toolset.md).

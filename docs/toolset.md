# Hacker News toolset

## Purpose

Give agents read access to Hacker News content (stories and items) for
summarisation, monitoring, and research tasks. Backed by the official Firebase
API at `https://hacker-news.firebaseio.com/v0/` (no authentication).

## Tools

### items.get(id)

Fetch one item (story, comment, job, poll, pollopt) by numeric id.

- Upstream: `GET /v0/item/{id}.json`.
- `id` must be a positive integer (`validation_error` otherwise).
- A `null` upstream body means the item does not exist → `not_found` error.
- Output: `{id, type, by?, posted_at?, title?, url?, text?, score?, descendants?, kids_count, deleted, dead}` (`posted_at` is a native `Date`).
  `kids_count` is the number of direct children; the full `kids` id array is
  intentionally not returned (unbounded).

### stories.list(kind?, limit?)

List current stories.

- `kind`: `top` (default) | `new` | `best` → `GET /v0/{kind}stories.json`.
- `limit`: default 10, hard max 30 (`validation_error` outside 1..30).
- Fetches each selected story id via `GET /v0/item/{id}.json`, in order.
- Deleted/dead/null items are skipped (so `actual_count` may be < `limit`).
- Output: `{kind, requested_limit, actual_count, truncated, stories[]}` where
  `truncated` is true when more ids were available upstream than requested and
  each story is `{id, title?, url?, by?, score?, posted_at?, comments}` (`posted_at` is a native `Date`).

## Bounds

Every expanding operation is bounded: `stories.list` caps at 30 stories per
call (31 upstream requests worst case). `items.get` performs exactly one
upstream request.

## Out of scope

- Search (Algolia HN Search is a different service/host).
- Comment-tree traversal (unbounded recursion; agents can walk ids via
  `items.get` deliberately).
- User profiles, writes of any kind (the HN API is read-only).

## Testing

Behaviour is grounded by declarative fixture cases in `tests/cases/`:
happy paths, a missing item, and bound violations, each asserting the exact
ordered upstream calls.

# Hacker News — service research

## Service overview

Hacker News (HN) exposes a read-only HTTP/JSON API for its content (stories,
comments, jobs, Ask HN / Show HN posts, polls, poll options, and user profiles).
It is served directly from a Firebase Realtime Database.

- **Base URL:** `https://hacker-news.firebaseio.com/v0/`
- **Protocol:** plain HTTPS GET requests. Every resource path ends in `.json`
  and returns a JSON value (object, array, scalar, or `null`).
- **Pretty printing:** append `?print=pretty` to any URL to get indented JSON
  (e.g. `https://hacker-news.firebaseio.com/v0/item/8863.json?print=pretty`).
  It only affects formatting, not content.
- **Identity model:** every item (story/comment/job/poll/pollopt) has a single
  unique integer `id`. Users are identified by a case-sensitive string username.
- **Versioning:** the path is versioned (`/v0/`). The docs state the data shape
  may change in non-backward-compatible ways across versions, but within a
  version "only removal of a non-optional field or alteration of an existing
  field will be considered incompatible changes," and "Clients should
  gracefully handle additional fields."
- **Realtime:** because the data is a Firebase database, the docs note you can
  subscribe to change notifications on individual items/profiles and on the
  updates feed using a Firebase client. This research package treats the service
  as a polling REST API; realtime streaming is documented but out of scope for a
  request/response tool design.

## Authentication

**None.** The API is fully public and unauthenticated. There are no API keys,
tokens, OAuth flows, headers, or query credentials. Any client can issue the GET
requests below anonymously.

## Endpoints

All endpoints are HTTP `GET`. There are no path/query parameters other than the
resource id embedded in the path and the optional `?print=pretty` formatting
flag. Responses are `Content-Type: application/json`.

### Item — `GET /v0/item/{id}.json`

Returns a single item by integer id. One JSON object covers all item types,
distinguished by the `type` field. Fields are present only when applicable (HN
omits empty/false fields — e.g. `deleted`, `dead`, `kids` may be absent).

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer | **Always present.** The item's unique id. |
| `type` | string | One of `"story"`, `"comment"`, `"job"`, `"poll"`, `"pollopt"`. |
| `by` | string | Username of the author. |
| `time` | integer | Creation time, **Unix seconds** (UTC epoch). |
| `deleted` | boolean | Present (`true`) only if the item is deleted. |
| `dead` | boolean | Present (`true`) only if the item is dead (e.g. flagged/killed). |
| `text` | string | Comment/Ask/job/pollopt body, as **HTML**. |
| `url` | string | Story/job target URL (may be an empty string for jobs). |
| `title` | string | Story/poll/job title (HTML). |
| `score` | integer | Story/poll/job points, or a pollopt's vote count. |
| `descendants` | integer | Total comment count, for stories and polls. |
| `kids` | array of integers | Ids of direct child comments, in HN display (ranked) order. |
| `parent` | integer | For comments: id of the parent comment or story. |
| `poll` | integer | For pollopts: id of the parent poll. |
| `parts` | array of integers | For polls: ids of the poll's option (`pollopt`) items. |

Observed field sets from the canonical examples in the docs (confirms which
fields each type carries):

- **story** (`/v0/item/8863.json`): `id, type, by, time, title, url, score, descendants, kids`.
- **comment** (`/v0/item/2921983.json`): `id, type, by, time, text, parent, kids`.
- **ask** (`/v0/item/121003.json`): story-typed with `id, type, by, time, title, text, score, descendants, kids` (self-post, no `url`).
- **job** (`/v0/item/192327.json`): `id, type, by, time, title, text, url, score` (no `descendants`/`kids`; `url` may be `""`).
- **poll** (`/v0/item/126809.json`): `id, type, by, time, title, score, descendants, kids, parts`.
- **pollopt** (`/v0/item/160705.json`): `id, type, by, time, text, score, poll`.

A request for a non-existent id returns the JSON literal `null` (HTTP 200).

### User — `GET /v0/user/{id}.json`

Returns a single user profile by case-sensitive username (e.g.
`/v0/user/jl.json`).

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | **Always present.** The username (case-sensitive). |
| `created` | integer | **Always present.** Account creation, Unix seconds. |
| `karma` | integer | **Always present.** The user's karma. |
| `about` | string | Optional self-description (HTML). |
| `submitted` | array of integers | Ids of the user's submitted items (stories, comments, polls), newest first. May be very large (thousands). |

A request for a non-existent username returns `null` (HTTP 200).

### Max item id — `GET /v0/maxitem.json`

Returns the current largest item id as a **bare integer** (e.g. `48492322`), not
an object. Useful for walking all items by counting down from the max.

### Story / category id lists

Each of these returns a **bare JSON array of integer item ids** (ranked order),
which you then resolve individually via the item endpoint.

| Endpoint | Contents | Documented size |
|----------|----------|-----------------|
| `GET /v0/topstories.json` | Current top stories (also contains jobs). | up to 500 ids |
| `GET /v0/newstories.json` | Newest stories. | up to 500 ids |
| `GET /v0/beststories.json` | Best stories. | up to 500 ids (grouped with top/new) |
| `GET /v0/askstories.json` | Latest Ask HN stories. | up to 200 ids |
| `GET /v0/showstories.json` | Latest Show HN stories. | up to 200 ids |
| `GET /v0/jobstories.json` | Latest job stories. | up to 200 ids |

The docs state the "up to 500" count explicitly for top and new stories, and
"up to 200 of the latest Ask HN, Show HN, and Job stories." `beststories` is
documented in the same top/new/best group.

### Updates — `GET /v0/updates.json`

Returns a feed of recently changed items and profiles:

```json
{ "items": [48492315, 48492193, ...], "profiles": ["brycewray", "dorkitude", ...] }
```

| Field | Type | Notes |
|-------|------|-------|
| `items` | array of integers | Ids of recently changed items. |
| `profiles` | array of strings | Usernames of recently changed profiles. |

This is the polling-friendly change feed. (The docs also describe subscribing to
the same data via Firebase realtime change notifications.)

## Limits and pagination

- **Rate limit:** "There is currently no rate limit." (No documented quota,
  throttling headers, or per-key limits — there are no keys.)
- **List sizes (the only "paging" the API offers):** id lists are returned whole,
  capped at the documented maxima — **up to 500** for `topstories` / `newstories`
  / `beststories`, **up to 200** for `askstories` / `showstories` / `jobstories`.
  There are no `limit`, `offset`, `page`, or cursor parameters; a client paginates
  by slicing the returned id array itself and fetching items on demand.
- **Comment threads:** an item's `kids` array lists only direct children; full
  thread depth requires recursively fetching each child item. `descendants` gives
  the total comment count but the API provides **no** flattened-thread or
  depth-limited traversal endpoint.
- **User submissions:** `submitted` is returned in full (can be thousands of ids);
  there is no server-side pagination of it.
- **Payload size / timeouts:** not documented.

## Errors

The official docs do not define an error envelope or enumerate status codes.
Observed behavior of the Firebase-backed endpoints:

- **Missing resource:** requesting a non-existent item or user returns HTTP `200`
  with the JSON body `null` (not a 404). Clients must treat a `null` body as
  "not found."
- **Malformed path:** Firebase REST conventions return non-200 responses (e.g.
  `400`/`401`/`404`) for malformed or unauthorized paths; the exact bodies are not
  documented by HN.
- **No structured error object** (no `{ "error": ... }` envelope is documented).
- **No rate-limit errors** are documented, consistent with "no rate limit."

Because errors are not specified upstream, robust clients should: validate ids
before requesting, treat `null` as not-found, and treat any non-`2xx` / non-JSON
response as a generic upstream failure.

## Writes

**The API is read-only.** The documentation describes only `GET` retrieval
endpoints. There are:

- No documented create/update/delete operations.
- No way to submit stories or comments, vote, flag, favorite, or edit profiles
  through this API.
- No idempotency keys, no bulk-write or transaction support (none are needed —
  there are no writes).

Voting, posting, and moderation happen only through the HN website, not this API.

## Not offered

Capabilities an agent might expect but that this API does **not** provide:

- **Search / filtering** — no full-text search, tag, date-range, or author filter.
  (HN search exists separately via the Algolia HN Search API on a different host;
  it is a distinct service, not part of this API.)
- **Writes of any kind** — see Writes above (no posting/voting/commenting/editing).
- **Pagination controls** — no `limit`/`offset`/`page`/cursor params; lists are
  fixed-size id arrays.
- **Batch / bulk fetch** — no endpoint to fetch multiple items in one request;
  each item id must be fetched individually.
- **Sorting / ranking parameters** — ranking is fixed per endpoint (top/new/best);
  you cannot request a custom sort.
- **Flattened comment trees** — only direct-child `kids` ids; no
  whole-thread/expanded-comments endpoint.
- **Webhooks** — no outbound HTTP callbacks. (Change observation is possible only
  by polling `/v0/updates.json` or by using a Firebase realtime subscription
  client; there is no push-to-your-server webhook.)
- **Authentication / per-user API access** — no keys, no OAuth, no private/
  authenticated data; only public profile fields are exposed.
- **Aggregate analytics** — no trending, counts-by-domain, or statistics
  endpoints; any analytics must be computed client-side from fetched items.

## Sources

- https://github.com/HackerNews/API — official Hacker News API documentation (README).
- https://raw.githubusercontent.com/HackerNews/API/master/README.md — raw README text.
- https://hacker-news.firebaseio.com/v0/item/8863.json — story example response.
- https://hacker-news.firebaseio.com/v0/item/2921983.json — comment example (referenced in docs).
- https://hacker-news.firebaseio.com/v0/item/121003.json — Ask HN example response.
- https://hacker-news.firebaseio.com/v0/item/192327.json — job example response.
- https://hacker-news.firebaseio.com/v0/item/126809.json — poll example response.
- https://hacker-news.firebaseio.com/v0/item/160705.json — pollopt example response.
- https://hacker-news.firebaseio.com/v0/user/jl.json — user example response.
- https://hacker-news.firebaseio.com/v0/maxitem.json — max item id (bare integer).
- https://hacker-news.firebaseio.com/v0/updates.json — updates feed (`items` / `profiles`).

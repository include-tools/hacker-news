# Hacker News — service research

## Service overview

Hacker News has two relevant public read APIs:

- **Official Hacker News Firebase API:** `https://hacker-news.firebaseio.com/v0/`.
  It exposes HN items, users, story id lists, `maxitem`, and `updates` as JSON
  values from a Firebase Realtime Database. Every documented REST path is a GET
  ending in `.json`.
- **Algolia HN Search API:** documented at `https://hn.algolia.com/api` with
  API paths under `/api/v1/`. It is built on Algolia Search and exposes item
  lookup, exact user lookup, and search endpoints for HN data. The docs show
  `http://hn.algolia.com/...`; probes used HTTPS successfully.

The Firebase API is the canonical HN item/profile store. The Algolia API is a
separate public search/index surface with different shapes, fields, pagination,
and rate limits.

## Authentication

**None.** Both the Firebase API and the Algolia HN Search API are public and
unauthenticated. The official docs describe no API keys, bearer tokens, OAuth,
cookies, credential headers, or credential query parameters. Probes were sent
without credentials.

## Endpoints

### Firebase API base

Base URL: `https://hacker-news.firebaseio.com/v0/`

All documented Firebase operations are `GET`. The only documented query
parameter is optional `print=pretty`, which pretty-prints JSON and does not
change the data.

### Firebase item — `GET /v0/item/{id}.json`

Path parameter:

- `id`: integer HN item id.

Returns one item object, or the JSON literal `null` for a missing id.

Documented item fields:

- `id` integer: item id.
- `deleted` boolean: present only when deleted.
- `type` string: one of `job`, `story`, `comment`, `poll`, `pollopt`.
- `by` string: author username.
- `time` integer: Unix time in seconds.
- `text` string: HTML item text.
- `dead` boolean: present only when dead.
- `parent` integer: comment parent id.
- `poll` integer: poll id for a poll option.
- `kids` array of integers: child comment ids in ranked display order.
- `url` string: story URL.
- `score` integer: story score or poll option votes.
- `title` string: story, poll, or job title.
- `parts` array of integers: poll option ids.
- `descendants` integer: story or poll comment count.

Documented item types use the same endpoint and are distinguished by `type`:

- Story: title/url/score/descendants/kids.
- Comment: text/parent/kids.
- Job: title/text/url/score.
- Poll: title/score/descendants/kids/parts.
- Poll option: text/score/poll.

### Firebase user — `GET /v0/user/{id}.json`

Path parameter:

- `id`: case-sensitive username.

Returns one user object, or the JSON literal `null` for a missing username.

Documented fields:

- `id` string: username.
- `created` integer: Unix time in seconds.
- `karma` integer.
- `about` string: optional HTML profile text.
- `submitted` array of integers: submitted item ids, newest first.

### Firebase max item — `GET /v0/maxitem.json`

Returns the current largest HN item id as a bare JSON integer.

### Firebase story lists

Each endpoint returns a bare JSON array of integer item ids. The client resolves
ids with `GET /v0/item/{id}.json`.

- `GET /v0/topstories.json`: current top stories; documented as up to 500 ids.
- `GET /v0/newstories.json`: newest stories; documented as up to 500 ids.
- `GET /v0/beststories.json`: best stories; documented with top/new stories.
- `GET /v0/askstories.json`: latest Ask HN stories; documented as up to 200 ids.
- `GET /v0/showstories.json`: latest Show HN stories; documented as up to 200 ids.
- `GET /v0/jobstories.json`: latest job stories; documented as up to 200 ids.

### Firebase updates — `GET /v0/updates.json`

Returns recently changed items and profiles:

```json
{ "items": [8423305, 8420805], "profiles": ["thefox", "mdda"] }
```

Fields:

- `items`: array of integer item ids.
- `profiles`: array of usernames.

### Algolia API base

Base URL used by probes: `https://hn.algolia.com/api/v1/`

All documented Algolia HN operations are `GET`.

### Algolia item — `GET /api/v1/items/{id}`

Path parameter:

- `id`: item id.

Returns an item object with recursively embedded `children`.

Documented response example fields:

- `id` integer.
- `created_at` ISO timestamp string.
- `author` string.
- `title` string or `null`.
- `url` string or `null`.
- `text` string or `null`.
- `points` integer or `null`.
- `parent_id` integer or `null`.
- `children` array of child item objects with the same general fields.

### Algolia user — `GET /api/v1/users/{username}`

Path parameter:

- `username`: exact username.

Returns an exact user profile. The docs do not describe full-text user search.

Documented response fields:

- `username` string.
- `about` string.
- `karma` integer.

### Algolia search by relevance — `GET /api/v1/search`

Sort order: relevance, then points, then number of comments.

Query parameters documented by the HN Search API page:

- `query` string: full-text query.
- `tags` string: filter tags. Available tags are `story`, `comment`, `poll`,
  `pollopt`, `show_hn`, `ask_hn`, `front_page`, `author_:USERNAME`, and
  `story_:ID`.
- `numericFilters` string: numeric conditions using `<`, `<=`, `=`, `>`, or
  `>=`. Available numeric fields are `created_at_i`, `points`, and
  `num_comments`.
- `page` integer: page number.
- `hitsPerPage` integer: mentioned by the docs as a request argument and
  returned in responses.
- `restrictSearchableAttributes` string: Algolia search parameter shown by the
  HN Search docs for URL-only search, for example
  `restrictSearchableAttributes=url`.

Tag semantics: tags are ANDed by default. Parentheses can OR tags, for example
`author_pg,(story,poll)` means author `pg` and type story or poll.

Examples documented by Algolia HN Search:

- `GET /api/v1/search?query=foo&tags=story`: stories matching `foo`.
- `GET /api/v1/search?query=bar&tags=comment`: comments matching `bar`.
- `GET /api/v1/search?query=bar&restrictSearchableAttributes=url`: URLs
  matching `bar`.
- `GET /api/v1/search?tags=front_page`: current front-page stories.
- `GET /api/v1/search?tags=story,author_pg`: stories by `pg`.
- `GET /api/v1/search?tags=comment,story_X`: comments on story `X`.

Documented response shape:

- `hits`: array of hit objects. Example hit fields include `title`, `url`,
  `author`, `points`, `story_text`, `comment_text`, `_tags`, `num_comments`,
  `objectID`, and `_highlightResult`.
- `page` integer.
- `nbHits` integer.
- `nbPages` integer.
- `hitsPerPage` integer.
- `processingTimeMS` integer.
- `query` string.
- `params` string.

### Algolia search by date — `GET /api/v1/search_by_date`

Sort order: newest first. It uses the same query parameters and response shape
as `/api/v1/search`.

Examples documented by Algolia HN Search:

- `GET /api/v1/search_by_date?tags=story`: latest stories.
- `GET /api/v1/search_by_date?tags=(story,poll)`: latest stories or polls.
- `GET /api/v1/search_by_date?tags=comment&numericFilters=created_at_i>X`:
  comments since Unix timestamp `X`.
- `GET /api/v1/search_by_date?tags=story&numericFilters=created_at_i>X,created_at_i<Y`:
  stories between Unix timestamps `X` and `Y`.

## Probes

Probes were run unauthenticated on 2026-06-11 and saved as response bodies only.

Firebase probes:

- `GET /v0/item/8863.json` → `docs/probes/firebase-item-8863.json`.
  Observed the canonical Dropbox story object.
- `GET /v0/item/999999999.json` → `docs/probes/firebase-item-missing.json`.
  Observed HTTP 200 body `null` for a missing item.
- `GET /v0/user/jl.json` → `docs/probes/firebase-user-jl.json`. Observed a
  large `submitted` array.
- `GET /v0/user/this-user-should-not-exist-20260611.json` →
  `docs/probes/firebase-user-missing.json`. Observed HTTP 200 body `null`.
- `GET /v0/maxitem.json` → `docs/probes/firebase-maxitem.json`. Observed a bare
  integer.
- `GET /v0/topstories.json` → `docs/probes/firebase-topstories.json`. Observed a
  bare id array.
- `GET /v0/askstories.json` → `docs/probes/firebase-askstories.json`. Observed a
  bare id array.
- `GET /v0/updates.json` → `docs/probes/firebase-updates.json`. Observed
  `items` and `profiles` arrays.

Algolia probes:

- `GET /api/v1/items/1` → `docs/probes/algolia-item-1.json`. Observed recursive
  `children` objects matching the documented item response example.
- `GET /api/v1/items/0` → `docs/probes/algolia-item-missing.json`. Observed
  HTTP 404 body `{"error":"Not Found","status":404}`.
- `GET /api/v1/users/pg` → `docs/probes/algolia-user-pg.json`. Observed
  `username`, `about`, and `karma`, matching the documented user shape.
- `GET /api/v1/search?query=foo&tags=story&hitsPerPage=2` →
  `docs/probes/algolia-search-stories.json`. Observed a live paginated story
  response with the documented response metadata.
- `GET /api/v1/search?query=bar&tags=comment&hitsPerPage=2` →
  `docs/probes/algolia-search-comments.json`. Observed a live comment search
  response.
- `GET /api/v1/search_by_date?tags=story&hitsPerPage=2` →
  `docs/probes/algolia-search-by-date-stories.json`. Observed newest-first story
  hits and empty string `query`.
- `GET /api/v1/search?tags=story,author_pg&hitsPerPage=2` →
  `docs/probes/algolia-search-author-pg.json`. Observed author filtering via
  `_tags` such as `author_pg`.
- `GET /api/v1/search?tags=story&numericFilters=points>999999999&hitsPerPage=2`
  → `docs/probes/algolia-search-empty.json`. Observed HTTP 200 with
  `hits: []`, `nbHits: 0`, and `nbPages: 0`.
- `GET /api/v1/search?query=foo&numericFilters=created_at_i>abc` →
  `docs/probes/algolia-search-bad-filter.json`. Observed HTTP 400 body
  `{"code":400,"message":"Invalid syntax for numeric condition:created_at_i>abc"}`.

Discrepancies and details not explicit in docs:

- Firebase missing resources are HTTP 200 `null`, not 404.
- Algolia missing item is HTTP 404 with an `{error,status}` body.
- Algolia bad numeric filter is HTTP 400 with `{code,message}`.
- Algolia `page` defaults to `0` in probes. The docs say `page` is a page number
  but do not state whether it is zero-based.

## Limits and pagination

Firebase:

- Rate limit: the official Hacker News API docs state, "There is currently no
  rate limit."
- Story list sizes: documented up to 500 ids for top/new/best and up to 200 ids
  for Ask HN, Show HN, and job stories.
- Pagination: no Firebase `limit`, `offset`, `page`, or cursor parameters are
  documented. Id lists and `submitted` arrays are returned whole; clients page by
  slicing locally.
- Payload size and timeout limits: not documented.

Algolia HN Search:

- Rate limit: the HN Search API page states requests from a single IP are limited
  to 10,000 per hour.
- Pagination: search responses include `page`, `nbPages`, and `hitsPerPage`.
  The docs state `page` and `hitsPerPage` can be specified in requests.
- Default `hitsPerPage`: observed as 20 in the docs example and probes when not
  overridden, but not stated as a formal default.
- Maximum `hitsPerPage`, maximum `page`, and maximum `nbPages`: not documented
  by the HN Search API page.

## Errors

Firebase:

- The official Firebase API docs do not define an error envelope or enumerate
  status codes.
- Missing item/user: observed HTTP 200 with JSON `null`.
- Rate-limit errors: not documented, consistent with the documented no-rate-limit
  statement.
- Malformed paths/non-JSON failures: not documented by HN; clients should treat
  non-2xx or non-JSON responses as upstream failures.

Algolia HN Search:

- The HN Search API page documents the rate limit but does not document a
  rate-limit status code or body.
- Missing item: observed HTTP 404 body `{"error":"Not Found","status":404}`.
- Bad numeric filter: observed HTTP 400 body
  `{"code":400,"message":"Invalid syntax for numeric condition:created_at_i>abc"}`.
- Empty search result: observed HTTP 200 with `hits: []`, `nbHits: 0`,
  `nbPages: 0`.
- Other upstream failures/status bodies: not documented.

## Writes

The documented Firebase API and Algolia HN Search API are read-only. They
document only `GET` endpoints.

Not documented in either API:

- Creating stories, comments, jobs, polls, or users.
- Editing or deleting content.
- Voting, flagging, favoriting, hiding, or moderating.
- Idempotency keys, transactions, or bulk write operations.

Write actions exist on the Hacker News website, not in these APIs.

## Not offered

- Firebase full-text search, tag filtering, author filtering, date filtering, or
  URL-only search. Those are offered only by the separate Algolia HN Search API.
- Algolia full-text user search. The documented user endpoint is exact lookup by
  username.
- Authenticated/private HN data or per-user API actions.
- Writes: no posting, commenting, voting, flagging, favoriting, or profile edits.
- Webhooks. Firebase realtime subscriptions are mentioned by the Firebase API
  docs, but no outbound webhook endpoint is documented.
- Firebase batch item fetch. Each Firebase item id is fetched individually.
- A flattened Firebase thread endpoint. Threads require recursive `kids` fetches.
- Documented global analytics endpoints such as trending domains or score
  histograms. Clients compute analytics from fetched/search results.

## Sources

- https://github.com/HackerNews/API — official Hacker News API documentation.
- https://raw.githubusercontent.com/HackerNews/API/master/README.md — raw
  official README.
- https://hn.algolia.com/api — official Algolia HN Search API documentation.
- Probe files under `docs/probes/`, listed in the Probes section above.

# Hacker News — agent use cases

Each use case below maps only to capabilities documented in
`service-research.md` (the read-only Firebase JSON API). None depend on search,
writes, webhooks, or any feature this API does not provide.

## 1. Summarize the current front page

Fetch a ranked id list (`/v0/topstories.json`, `/v0/beststories.json`, or
`/v0/newstories.json`), take the first N ids, resolve each via
`/v0/item/{id}.json`, and produce a digest of titles, links, scores, and comment
counts (`descendants`). Foundational "what's on HN right now" task.

- **Uses:** topstories/beststories/newstories lists + item endpoint.

## 2. Track Show HN, Ask HN, or job postings

Same pattern as #1 but against the category lists `/v0/showstories.json`,
`/v0/askstories.json`, or `/v0/jobstories.json` (up to 200 ids each) — e.g. a
daily "new Show HN projects" or "latest HN job postings" feed.

- **Uses:** ask/show/job story lists + item endpoint.

## 3. Expand a single item by id (deep-link / lookup)

Given an HN item id (from a URL or another tool), fetch `/v0/item/{id}.json` and
return its normalized fields (title, author, time, url/text, score). Handles the
`null` body as "not found."

- **Uses:** item endpoint.

## 4. Build a story + comment-thread report

Fetch a story item, then walk its `kids` ids recursively via repeated
`/v0/item/{id}.json` calls (skipping `deleted`/`dead`) to reconstruct the
discussion, optionally bounded by depth/breadth. Useful for summarizing the
conversation under a post.

- **Uses:** item endpoint (`kids` traversal); `descendants` for total size.

## 5. Profile a user

Fetch `/v0/user/{id}.json` to report karma, account age (`created`), bio
(`about`), and submission count, and optionally resolve recent ids from
`submitted` into actual items to show what they post about.

- **Uses:** user endpoint + item endpoint.

## 6. Poll for new/changed content (lightweight change feed)

Periodically read `/v0/updates.json` to learn which item ids and profiles changed
since the last poll, then re-fetch just those resources — an efficient monitor
that avoids re-scanning whole lists. Alternatively count down from
`/v0/maxitem.json` to discover brand-new items.

- **Uses:** updates endpoint, maxitem endpoint, item/user endpoints.

## 7. Topic / keyword monitoring (client-side filter)

Since the API has no search, poll `newstories.json` (or `updates.json`), fetch
the items, and filter client-side on title/text/url for keywords or domains of
interest — surfacing matching stories as they appear.

- **Uses:** newstories/updates + item endpoint (filtering done by the agent, not
  the API).

## 8. Lightweight analytics over a fetched set

Pull a list (e.g. top 100 stories), fetch the items, and compute client-side
aggregates: score distribution, most-active domains (from `url`), comment-count
(`descendants`) leaders, or posting-time patterns (`time`). All computation is
agent-side; the API only supplies the raw items.

- **Uses:** story lists + item endpoint.

## Out of scope (not supported by the API)

- Posting, commenting, voting, flagging, or editing — the API is read-only.
- Server-side search, sorting, or filtering — must be done client-side.
- Batch item fetch, pagination cursors, or webhooks — fetch ids individually and
  poll `/v0/updates.json` for changes.

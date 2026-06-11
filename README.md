# hacker-news

**Give your agent Hacker News.** Front-page digests, Algolia-powered story and
comment search, Show HN trackers, comment-thread summaries, user profiles, and
live change monitoring — bounded, tested tools instead of raw API choreography.

Built on the official Hacker News API and public Algolia HN Search API: no key,
no signup, read-only.
A [toolbox](https://github.com/solidarity-ai/toolbox) package.

## What your agent can do with it

| Ask | Tool |
|---|---|
| "What's on the front page right now?" — titles, links, scores, comment counts | `stories.list` |
| "Find HN stories about WebAssembly by newest first" | `stories.search` |
| "Find comments mentioning this bug under story 123" | `comments.search` |
| A daily Show HN / Ask HN / who's-hiring feed | `stories.list` (`kind: "show" / "ask" / "job"`) |
| "Summarize the discussion under this post" | `threads.get` — bounded comment-tree walk |
| "Who is this user and what do they post about?" | `users.get` — karma, account age, submitted-item sample hydrated |
| "Verify this username in Algolia's index" | `users.search` |
| Watch for newly created items | `items.recent` |
| A cheap change feed for dashboards and caches | `updates.get` |
| Resolve any HN deep link or id | `items.get` |

The Firebase API is a bare id store — every feed is an array of ids, every item
is its own fetch — while Algolia supplies the search index. Each tool compresses
that work into **one bounded call** with explicit accounting, so your agent never
hand-orchestrates fifty lookups or an unbounded search page.

## Quickstart

```sh
toolbox install github.com/include-tools/hacker-news@v0.1.1   # adds it to ./toolbox.toolset.json
claude   # with an .mcp.json exposing `toolbox codemode mcp`
```

Then just ask: *"Summarize today's top 10 HN stories and pull the three most
interesting comment threads."*

## The tools

| Tool | Does | Bounds |
|---|---|---|
| `stories.list` | Ranked feeds (top/new/best/ask/show/job) hydrated into lean summaries | `limit` ≤ 30, `offset` paging |
| `stories.search` | Algolia story search by relevance/date with tag and numeric filters | `limit` ≤ 50, `page` |
| `comments.search` | Algolia comment search by query, story, author, and time window | `limit` ≤ 50, `page` |
| `items.get` | One item (story/comment/job/poll) by id, normalized | single fetch |
| `threads.get` | Comment tree under a story, breadth-first with cycle safety | max depth + node budget |
| `users.get` | Profile + optionally hydrated submitted-item sample | submission hydration capped |
| `users.search` | Exact Algolia user profile lookup | single fetch |
| `items.recent` | Newest items walked back from `maxitem` | fetch budget |
| `updates.get` | HN's changed-items/profiles feed | single fetch |

Every result that can truncate tells you it did (`truncated`, plus
`requested_limits` / `actual_counts`), timestamps are native `Date`s, and
deleted/dead/missing items inside a fan-out are counted and skipped — never
silent, never fatal.

Full contract — per-tool inputs, outputs, error mapping, and design rationale —
in [`docs/toolset.md`](docs/toolset.md).

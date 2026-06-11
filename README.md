# hacker-news

**Give your agent Hacker News.** Front-page digests, Show HN trackers,
comment-thread summaries, user profiles, and live change monitoring — six
bounded, tested tools instead of hundreds of raw `item/{id}.json` fetches.

Built on the official Hacker News API: no key, no signup, read-only.
A [toolbox](https://github.com/solidarity-ai/toolbox) package.

## What your agent can do with it

| Ask | Tool |
|---|---|
| "What's on the front page right now?" — titles, links, scores, comment counts | `stories.list` |
| A daily Show HN / Ask HN / who's-hiring feed | `stories.list` (`kind: "show" / "ask" / "job"`) |
| "Summarize the discussion under this post" | `threads.get` — bounded comment-tree walk |
| "Who is this user and what do they post about?" | `users.get` — karma, account age, recent submissions hydrated |
| Watch for new submissions matching a keyword | `items.recent` + filter on your side |
| A cheap change feed for dashboards and caches | `updates.get` |
| Resolve any HN deep link or id | `items.get` |

The HN API is a bare id store — every feed is an array of ids, every item is its
own fetch. Each tool here compresses that fan-out into **one bounded call** with
explicit accounting, so your agent never hand-orchestrates fifty lookups (and
can never accidentally start five thousand).

## Quickstart

```sh
git clone https://github.com/include-tools/hacker-news
cd hacker-news
toolbox install     # resolves the toolset (toolbox.toolset.json)
claude              # .mcp.json exposes the tools via `toolbox codemode mcp`
```

Then just ask: *"Summarize today's top 10 HN stories and pull the three most
interesting comment threads."*

## The six tools

| Tool | Does | Bounds |
|---|---|---|
| `stories.list` | Ranked feeds (top/new/best/ask/show/job) hydrated into lean summaries | `limit` ≤ 30, `offset` paging |
| `items.get` | One item (story/comment/job/poll) by id, normalized | single fetch |
| `threads.get` | Comment tree under a story, breadth-first with cycle safety | max depth + node budget |
| `users.get` | Profile + optionally hydrated recent submissions | submission hydration capped |
| `items.recent` | Newest items walked back from `maxitem` | fetch budget |
| `updates.get` | HN's changed-items/profiles feed | single fetch |

Every result that can truncate tells you it did (`truncated`, plus
`requested_limits` / `actual_counts`), timestamps are native `Date`s, and
deleted/dead/missing items inside a fan-out are counted and skipped — never
silent, never fatal.

Full contract — per-tool inputs, outputs, error mapping, and design rationale —
in [`docs/toolset.md`](docs/toolset.md).

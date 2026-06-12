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
toolbox install github.com/include-tools/hacker-news@v0.1.0
```

## The tools

| Tool | Does | Bounds |
|---|---|---|
| `stories.list` | Ranked feeds (top/new/best/ask/show/job) hydrated into lean summaries | `limit` ≤ 30, `offset` paging |
| `stories.search` | Algolia story search by relevance/date with tag and numeric filters | `limit` ≤ 50, `page` |
| `comments.search` | Algolia comment search by query, story, author, and time window | `limit` ≤ 50, `page` |
| `items.get` | One item (story/comment/job/poll) by id, normalized | single fetch |
| `threads.get` | Comment tree under a story, breadth-first with cycle safety | max depth + node budget |
| `users.get` | Profile + optionally hydrated submitted-item sample | `include_recent` ≤ 30, truncation reported |
| `users.search` | Exact Algolia user profile lookup | single fetch |
| `items.recent` | Newest items walked back from `maxitem` | fetch budget |
| `updates.get` | HN's changed-items/profiles feed | 100 item ids + 100 profiles, truncation reported |

The package is unauthenticated and read-only, allows only
`hacker-news.firebaseio.com` and `hn.algolia.com`, returns native `Date`
timestamps, reports truncation with `requested_limits` and `actual_counts`, and
counts deleted, dead, or missing fan-out items instead of silently hiding them;
the full contract is in [`docs/toolset.md`](docs/toolset.md).

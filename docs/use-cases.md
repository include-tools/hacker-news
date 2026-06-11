# Hacker News — agent use cases

Each use case maps to endpoints documented in `docs/service-research.md`: the
official Firebase API and the public Algolia HN Search API.

## 1. Summarize current HN feeds

Fetch a ranked Firebase id list (`/v0/topstories.json`, `/v0/beststories.json`,
`/v0/newstories.json`, `/v0/askstories.json`, `/v0/showstories.json`, or
`/v0/jobstories.json`), hydrate selected ids with `/v0/item/{id}.json`, and
summarize titles, URLs, authors, scores, and comment counts.

## 2. Search stories by topic, author, date, or front-page status

Use Algolia `/api/v1/search` for relevance-ranked story searches, or
`/api/v1/search_by_date` for newest-first results. Apply documented `query`,
`tags` (`story`, `ask_hn`, `show_hn`, `front_page`, `author_:USERNAME`), and
`numericFilters` (`created_at_i`, `points`, `num_comments`) to find matching
stories.

## 3. Search comments and discussion history

Use Algolia search with `tags=comment`, optionally combined with
`story_:ID`, `author_:USERNAME`, and `created_at_i` numeric filters, to find
comments matching a phrase, comments by a user, comments under a specific story,
or recent comments in a time window.

## 4. Resolve a single HN item by id

Fetch `/v0/item/{id}.json` for the canonical Firebase item shape, or
`/api/v1/items/{id}` when an Algolia-style item with recursively embedded
children is useful. Treat Firebase `null` and Algolia 404 as missing resources.

## 5. Build a bounded story and comment-thread report

Fetch a Firebase story item, then recursively fetch its `kids` with
`/v0/item/{id}.json` to reconstruct a bounded discussion tree. Use
`descendants` for total comment count and `kids` for direct child traversal.

## 6. Profile or verify a user

Use Firebase `/v0/user/{id}.json` for account creation time, karma, bio, and the
`submitted` item id list. Use Algolia `/api/v1/users/{username}` for exact
username lookup with Algolia's `username`, `about`, and `karma` shape.

## 7. Poll for changed or newly created content

Read Firebase `/v0/updates.json` to learn recently changed item ids and profiles,
then re-fetch just those resources. Alternatively read `/v0/maxitem.json` and
walk item ids downward to discover newest items of any type.

## 8. Compute lightweight analytics from fetched or searched results

Use Firebase feed/item results or Algolia search hits to compute client-side
summaries such as top domains, score distributions, most-commented results, or
topic-specific activity over time. The APIs provide raw items/search hits, not
precomputed analytics endpoints.

## Out of scope

- Posting, commenting, voting, flagging, favoriting, or editing.
- Authenticated/private HN data.
- Webhooks.
- Firebase server-side search or batch item fetch.
- Algolia full-text user search; the documented user endpoint is exact lookup.

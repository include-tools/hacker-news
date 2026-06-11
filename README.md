# hacker-news

A [toolbox](https://github.com/solidarity-ai/toolbox) tool package for the official
Hacker News Firebase API (`hacker-news.firebaseio.com`, no auth). Produced by toolfactory4.

## Tools

### `items.get(id)`

Fetch one item (story, comment, job, poll, pollopt) by numeric id.

- `id` — positive integer (required).
- Returns `{id, type, by?, posted_at?, title?, url?, text?, score?, descendants?, kids_count, deleted, dead}` (`posted_at` is a native `Date`).
- Errors: `validation_error` (bad id), `not_found` (no such item), `upstream_error`.

### `stories.list(kind?, limit?)`

List current stories.

- `kind` — `top` (default), `new`, or `best`.
- `limit` — default 10, hard max 30.
- Returns `{kind, requested_limit, actual_count, truncated, stories[]}`; each story is
  `{id, title?, url?, by?, score?, posted_at?, comments}` (`posted_at` is a native `Date`). Deleted/dead items are skipped.
- Errors: `validation_error` (bad kind/limit), `upstream_error`.

## Development

```
npm install
npm run typecheck
```

Declarative fixture tests live in `tests/cases/*.json`; the factory harness executes
them against the real toolbox runtime with a mocked fetch transport. The design is
documented in `docs/toolset.md`.

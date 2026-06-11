# hacker-news

A [toolbox](https://github.com/solidarity-ai/toolbox) tool package, produced by toolfactory4.

## Tools

_Documented per tool once implemented: name, parameters, bounds/defaults, output shape._

## Development

```
npm install
npm run typecheck
```

Declarative fixture tests live in `tests/cases/*.json`; the factory harness executes
them against the real toolbox runtime with a mocked fetch transport.

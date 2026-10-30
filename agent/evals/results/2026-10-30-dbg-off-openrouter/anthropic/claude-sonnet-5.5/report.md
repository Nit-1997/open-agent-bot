# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: dbg-off | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | pass FAIL | text_matches(pattern=°) x1 | 12.5 | 2.5 | 14.0 | $0.0349 | 7 | new |

Passed 1 of 2 runs.

## Failures

- cities-fanout run 2
  - text_matches(pattern=°): /°/ on reply text

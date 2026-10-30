# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-on | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL pass | text_matches(pattern=°) x1 | 15.0 | 4.0 | 12.3 | $0.0367 | 10 | new |

Passed 1 of 2 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text

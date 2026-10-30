# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-off | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL pass | text_matches(pattern=°) x1 | 13.0 | 3.0 | 15.4 | $0.0463 | 8 | new |

Passed 1 of 2 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text

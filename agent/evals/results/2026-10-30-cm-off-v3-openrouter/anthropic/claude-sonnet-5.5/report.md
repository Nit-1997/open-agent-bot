# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-off-v3 | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL FAIL FAIL pass | text_matches(pattern=°) x3 | 12.8 | 2.8 | 15.0 | $0.0403 | 8 | new |

Passed 1 of 4 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text
- cities-fanout run 2
  - text_matches(pattern=°): /°/ on reply text
- cities-fanout run 3
  - text_matches(pattern=°): /°/ on reply text

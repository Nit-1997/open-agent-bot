# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: events-before-followups | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| events | FAIL FAIL | widget_matches(kind=ui, pattern="type":"cards") x2; text_matches(pattern=kid\|famil\|child) x1 | 4.0 | 3.0 | 9.8 | $0.0308 | 8 | new |

Passed 0 of 2 runs.

## Failures

- events run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 1 ui widget(s)
- events run 2
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 1 ui widget(s)
  - text_matches(pattern=kid|famil|child): /kid|famil|child/ on reply text

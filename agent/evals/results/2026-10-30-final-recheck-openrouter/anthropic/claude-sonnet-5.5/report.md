# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: final-recheck | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | FAIL pass | widget_matches(kind=ui, pattern=https?://) x1 | 2.5 (-3.0) | 2.5 | 23.3 (-4.3) | $0.0216 (-$0.1478) | 7 (-74328) | REGRESSION 2/2 -> 1/2 |
| events | FAIL FAIL | widget_matches(kind=ui, pattern="type":"cards") x2; widget_matches(kind=ui, pattern=kid\|famil\|child) x1; widget_matches(kind=ui, pattern=free\|\$\d) x1; text_matches(pattern=kid\|famil\|child) x1 | 3.0 | 3.0 | 10.2 | $0.0198 | 8 | new |

Passed 1 of 4 runs.

## Failures

- car run 1
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
- events run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=kid|famil|child): /kid|famil|child/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=free|\$\d): /free|\$\d/ on 0 ui widget(s)
- events run 2
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 1 ui widget(s)
  - text_matches(pattern=kid|famil|child): /kid|famil|child/ on reply text

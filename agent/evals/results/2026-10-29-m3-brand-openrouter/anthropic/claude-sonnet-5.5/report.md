# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m3-brand | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| hotel-brand | FAIL | text_matches(pattern=Marriott\|Hyatt); text_matches(pattern=€\|EUR) | 2.0 | 3.0 | 17.6 (-5.2) | $0.0170 (-$0.0668) | 8 (-35698) | same |

Passed 0 of 1 runs.

## Failures

- hotel-brand run 1
  - text_matches(pattern=Marriott|Hyatt): /Marriott|Hyatt/ on reply text
  - text_matches(pattern=€|EUR): /€|EUR/ on reply text

## Future assertions (not counted)

- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))

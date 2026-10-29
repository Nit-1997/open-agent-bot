# Eval report: chat-sonnet-5.5

label: m3 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | pass pass | - | 9.0 (+3.5) | 6.5 | 48.4 (+20.8) | $0.2254 (+$0.0560) | 100434 (+26099) | same |
| hotel-brand | pass pass | - | 3.0 (+1.0) | 4.0 | 20.4 (-2.4) | $0.0842 (+$0.0004) | 37546 (+1840) | improved 0/2 -> 2/2 |
| playlist | pass pass | - | 5.5 (+2.0) | 5.0 | 30.9 (+7.2) | $0.1362 (+$0.0156) | 51794 (+5845) | same |
| trip | pass pass | - | 6.0 (-0.5) | 4.0 | 35.1 (+3.9) | $0.1118 (-$0.0410) | 43022 (-21143) | same |

Passed 8 of 8 runs.

## Future assertions (not counted)

- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- hotel-brand run 2
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- trip run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 1 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)
- trip run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 1 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)

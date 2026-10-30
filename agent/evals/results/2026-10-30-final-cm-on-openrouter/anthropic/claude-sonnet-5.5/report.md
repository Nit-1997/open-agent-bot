# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: final-cm-on | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | FAIL | widget_matches(kind=ui, pattern=https?://) | 2.0 (-3.5) | 2.0 | 23.3 (-4.3) | $0.0425 (-$0.1269) | 6 (-74329) | REGRESSION 2/2 -> 0/1 |
| cities-fanout | pass | - | 14.0 | 3.0 | 10.5 | $0.0248 | 8 | new |
| dining | pass | - | 6.0 (-1.0) | 6.0 | 21.7 (-1.4) | $0.0434 (-$0.1241) | 14 (-73583) | same |
| events | FAIL | widget_matches(kind=ui, pattern="type":"cards") | 3.0 | 3.0 | 9.0 | $0.0209 | 8 | new |
| gifts | pass | - | 3.0 | 4.0 | 56.2 | $0.0658 | 10 | new |
| grocery-offlist | pass | - | 2.0 (-1.5) | 3.0 | 14.1 (-17.5) | $0.0435 (-$0.0683) | 8 (-50318) | same |
| hotel-brand | pass | - | 1.0 (-1.0) | 2.0 | 15.3 (-7.5) | $0.0154 (-$0.0684) | 6 (-35700) | improved 0/2 -> 1/1 |
| india-shop | pass | - | 2.0 (-5.5) | 3.0 | 55.1 (+24.3) | $0.0366 (-$0.1879) | 8 (-101030) | same |
| party-followup | pass | - | 6.0 (-1.0) | 6.0 | 41.9 (-51.5) | $0.1656 (-$0.1197) | 16 (-120255) | improved 0/2 -> 1/1 |
| party | pass | - | 4.0 (-1.0) | 4.0 | 33.5 (-37.0) | $0.0562 (-$0.1374) | 10 (-82564) | same |
| playlist | pass | - | 3.0 (-0.5) | 4.0 | 16.3 (-7.4) | $0.0338 (-$0.0868) | 10 (-45939) | same |
| recipe-cart | pass | - | 2.0 | 3.0 | 30.5 (-1.9) | $0.0453 (-$0.0766) | 8 (-56610) | same |
| research | pass | - | 2.0 (-11.0) | 3.0 | 57.5 (+4.6) | $0.0185 (-$0.3561) | 8 (-157576) | same |
| store-domain | pass | - | 1.0 (-7.0) | 2.0 | 14.3 (-14.8) | $0.0099 (-$0.1604) | 6 (-77231) | improved 0/2 -> 1/1 |
| trip | pass | - | 5.0 (-1.5) | 4.0 | 27.0 (-4.2) | $0.0383 (-$0.1145) | 10 (-64155) | same |

Passed 13 of 15 runs.

## Failures

- car run 1
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
- events run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 1 ui widget(s)

## Future assertions (not counted)

- dining run 1
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [ui, followups])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party-followup run 1
  - would pass: must_call(tool=plan) @turn 2 (plan called 1x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
- trip run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 1 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)

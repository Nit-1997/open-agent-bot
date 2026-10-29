# Eval report: chat-sonnet-5.5

label: m2-final | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | pass pass | - | 6.0 (+0.5) | 4.5 | 28.2 (+0.6) | $0.1465 (-$0.0229) | 63788 (-10547) | same |
| dining | pass pass | - | 8.0 (+1.0) | 5.5 | 25.0 (+1.9) | $0.1376 (-$0.0299) | 58369 (-15228) | same |
| events | pass pass | - | 10.5 | 5.0 | 37.9 | $0.1962 | 84664 | new |
| gifts | FAIL pass | error: terminated x1; widget_matches(kind=ui, pattern="type":"cards") x1; widget_matches(kind=ui, pattern=coffee\|cook\|kitchen\|chef\|brew) x1; text_matches(pattern=\$\d) x1; max_duration_s(n=300) x1 | 5.0 | 6.0 | 193.0 | $0.1618 | 68569 | new |
| grocery-offlist | pass pass | - | 3.0 (-0.5) | 4.0 | 26.4 (-5.2) | $0.0799 (-$0.0319) | 36440 (-13886) | same |
| hotel-brand | pass pass | - | 3.0 (+1.0) | 4.0 | 23.0 (+0.2) | $0.0830 (-$0.0008) | 35196 (-510) | improved 0/2 -> 2/2 |
| india-shop | pass pass | - | 8.0 (+0.5) | 6.0 | 35.9 (+5.1) | $0.1894 (-$0.0351) | 83885 (-17153) | same |
| party | pass FAIL | widget_present(kind=cart) x1 | 5.5 (+0.5) | 5.5 | 66.3 (-4.2) | $0.1411 (-$0.0525) | 58751 (-23823) | REGRESSION 2/2 -> 1/2 |
| party-followup | FAIL FAIL | max_unverified_claims(n=2) x1; widget_present(kind=cart) @turn 1 x1 | 7.5 (+0.5) | 8.0 | 122.9 (+29.5) | $0.2620 (-$0.0233) | 112748 (-7523) | same |
| playlist | pass pass | - | 4.0 (+0.5) | 4.5 | 22.1 (-1.6) | $0.1096 (-$0.0110) | 41992 (-3957) | same |
| recipe-cart | pass pass | - | 3.0 (+1.0) | 4.0 | 34.0 (+1.6) | $0.1211 (-$0.0008) | 55728 (-890) | same |
| research | pass pass | - | 13.5 (+0.5) | 8.5 | 52.6 (-0.3) | $0.4101 (+$0.0355) | 174205 (+16621) | same |
| store-domain | FAIL FAIL | max_tool_calls(n=3) x2 | 9.0 (+1.0) | 7.5 | 29.3 (+0.2) | $0.1700 (-$0.0003) | 76162 (-1075) | same |
| trip | pass pass | - | 6.0 (-0.5) | 4.0 | 30.9 (-0.3) | $0.1096 (-$0.0432) | 41833 (-22332) | same |

Passed 22 of 28 runs.

## Failures

- gifts run 1: terminated
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=coffee|cook|kitchen|chef|brew): /coffee|cook|kitchen|chef|brew/ on 0 ui widget(s)
  - text_matches(pattern=\$\d): /\$\d/ on reply text
  - max_duration_s(n=300): 332.8s, max 300s
- party run 2
  - widget_present(kind=cart): cart shown 0x; saw [followups, ui]
- party-followup run 1
  - max_unverified_claims(n=2): 3 unverified, max 2
- party-followup run 2
  - widget_present(kind=cart) @turn 1: cart shown 0x; saw [followups, ui]
- store-domain run 1
  - max_tool_calls(n=3): 8 calls, max 3
- store-domain run 2
  - max_tool_calls(n=3): 10 calls, max 3

## Future assertions (not counted)

- dining run 1
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [followups, ui])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- dining run 2
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [followups, ui])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- grocery-offlist run 2
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- hotel-brand run 2
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- party run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party-followup run 2
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
- research run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
- trip run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 1 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)
- trip run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 1 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)

# Eval report: chat-sonnet-5.5

label: baseline | date: 2026-10-29 | baseline: none

| Scenario | Runs | Failed assertions | Tool calls | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|
| car | pass pass | - | 5.5 | 27.6 | $0.1694 | 74335 | new |
| dining | pass pass | - | 7.0 | 23.1 | $0.1675 | 73597 | new |
| grocery-offlist | pass pass | - | 3.5 | 31.6 | $0.1118 | 50326 | new |
| hotel-brand | FAIL FAIL | not tool_result_matches(tool=stays, pattern=up to \$400) x2 | 2.0 | 22.8 | $0.0838 | 35706 | new |
| india-shop | pass pass | - | 7.5 | 30.8 | $0.2245 | 101038 | new |
| party | pass pass | - | 5.0 | 70.5 | $0.1936 | 82574 | new |
| party-followup | FAIL FAIL | must_call(tool=shop) @turn 2 x2; tool_arg_matches(tool=shop, pattern="qty") @turn 2 x2; max_unverified_claims(n=2) x1 | 7.0 | 93.4 | $0.2853 | 120271 | new |
| playlist | pass pass | - | 3.5 | 23.7 | $0.1206 | 45949 | new |
| recipe-cart | pass pass | - | 2.0 | 32.4 | $0.1219 | 56618 | new |
| research | pass pass | - | 13.0 | 52.9 | $0.3746 | 157584 | new |
| store-domain | FAIL FAIL | max_tool_calls(n=3) x2 | 8.0 | 29.1 | $0.1703 | 77237 | new |
| trip | pass pass | - | 6.5 | 31.2 | $0.1528 | 64165 | new |

Passed 18 of 24 runs.

## Failures

- hotel-brand run 1
  - not tool_result_matches(tool=stays, pattern=up to \$400): negated: /up to \$400/ on 1 stays result(s)
- hotel-brand run 2
  - not tool_result_matches(tool=stays, pattern=up to \$400): negated: /up to \$400/ on 1 stays result(s)
- party-followup run 1
  - must_call(tool=shop) @turn 2: shop called 0x
  - tool_arg_matches(tool=shop, pattern="qty") @turn 2: /"qty"/ on 0 shop call(s)
  - max_unverified_claims(n=2): 4 unverified, max 2
- party-followup run 2
  - must_call(tool=shop) @turn 2: shop called 0x
  - tool_arg_matches(tool=shop, pattern="qty") @turn 2: /"qty"/ on 0 shop call(s)
- store-domain run 1
  - max_tool_calls(n=3): 8 calls, max 3
- store-domain run 2
  - max_tool_calls(n=3): 8 calls, max 3

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
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- hotel-brand run 2
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
- party run 2
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party-followup run 2
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- research run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 0 load_skill call(s))
- research run 2
  - would fail: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 0 load_skill call(s))
- trip run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 0 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)
- trip run 2
  - would fail: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 0 load_skill call(s))
  - would fail: must_call(tool=plan) (plan called 0x)

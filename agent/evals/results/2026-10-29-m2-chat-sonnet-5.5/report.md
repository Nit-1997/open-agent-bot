# Eval report: chat-sonnet-5.5

label: m2 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|
| car | pass pass | - | 6.0 (+0.5) | 30.4 (+2.8) | $0.1356 (-$0.0338) | 58230 (-16105) | same |
| dining | pass pass | - | 10.0 (+3.0) | 26.3 (+3.2) | $0.1613 (-$0.0062) | 70628 (-2969) | same |
| grocery-offlist | pass pass | - | 3.5 | 27.4 (-4.2) | $0.0927 (-$0.0191) | 42566 (-7760) | same |
| hotel-brand | pass pass | - | 3.5 (+1.5) | 27.3 (+4.5) | $0.0996 (+$0.0158) | 42511 (+6805) | improved 0/2 -> 2/2 |
| india-shop | pass FAIL | text_matches(pattern=amazon\.in\|flipkart) x1 | 12.0 (+4.5) | 37.8 (+7.0) | $0.3725 (+$0.1480) | 168515 (+67477) | REGRESSION 2/2 -> 1/2 |
| party-followup | FAIL FAIL | widget_present(kind=cart) @turn 1 x1; tool_arg_matches(tool=shop, pattern="qty") @turn 2 x2; max_unverified_claims(n=2) x1 | 8.5 (+1.5) | 123.4 (+30.0) | $0.3148 (+$0.0295) | 139449 (+19178) | same |
| party | pass pass | - | 4.0 (-1.0) | 46.7 (-23.8) | $0.1395 (-$0.0541) | 58657 (-23917) | same |
| playlist | pass pass | - | 5.0 (+1.5) | 25.5 (+1.8) | $0.1272 (+$0.0066) | 49132 (+3183) | same |
| recipe-cart | pass pass | - | 3.0 (+1.0) | 33.6 (+1.2) | $0.1217 (-$0.0002) | 56653 (+35) | same |
| research | pass pass | - | 14.5 (+1.5) | 64.7 (+11.8) | $0.5232 (+$0.1486) | 226154 (+68570) | same |
| store-domain | FAIL FAIL | max_tool_calls(n=3) x2 | 7.5 (-0.5) | 25.6 (-3.5) | $0.1218 (-$0.0485) | 54156 (-23081) | same |
| trip | pass pass | - | 6.0 (-0.5) | 31.7 (+0.5) | $0.1134 (-$0.0394) | 42876 (-21289) | same |

Passed 19 of 24 runs.

## Failures

- india-shop run 2
  - text_matches(pattern=amazon\.in|flipkart): /amazon\.in|flipkart/ on reply text
- party-followup run 1
  - widget_present(kind=cart) @turn 1: cart shown 0x; saw [ui, followups]
  - tool_arg_matches(tool=shop, pattern="qty") @turn 2: /"qty"/ on 2 shop call(s)
- party-followup run 2
  - tool_arg_matches(tool=shop, pattern="qty") @turn 2: /"qty"/ on 1 shop call(s)
  - max_unverified_claims(n=2): 4 unverified, max 2
- store-domain run 1
  - max_tool_calls(n=3): 7 calls, max 3
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
  - would fail: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- grocery-offlist run 2
  - would fail: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- hotel-brand run 2
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party-followup run 2
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- party run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
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

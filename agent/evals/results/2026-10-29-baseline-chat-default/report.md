# Eval report: chat-default

label: baseline | date: 2026-10-29 | baseline: none

| Scenario | Runs | Failed assertions | Tool calls | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|
| car | FAIL FAIL | widget_matches(kind=ui, pattern=https?://) x2 | 5.5 | 78.1 | $0.0000 | 12159 | new |
| dining | FAIL FAIL | max_tool_calls(n=14) x2 | 22.5 | 39.3 | $0.0000 | 5630 | new |
| grocery-offlist | pass pass | - | 1.5 | 21.7 | $0.0000 | 2448 | new |
| hotel-brand | FAIL FAIL | widget_matches(kind=stay_list, pattern=€\|EUR) x2; not tool_result_matches(tool=stays, pattern=up to \$400) x2; max_unverified_claims(n=2) x1 | 2.0 | 28.9 | $0.0000 | 6323 | new |
| india-shop | FAIL pass | max_tool_calls(n=12) x1 | 9.5 | 49.3 | $0.0000 | 11169 | new |
| party | FAIL FAIL | widget_present(kind=cart) x2; max_unverified_claims(n=2) x1; must_call(tool=shop) x1 | 2.5 | 26.7 | $0.0000 | 1071 | new |
| party-followup | FAIL FAIL | must_call(tool=shop) @turn 1 x1; widget_present(kind=cart) @turn 1 x2; must_call(tool=shop) @turn 2 x1; tool_arg_matches(tool=shop, pattern="qty") @turn 2 x1; max_unverified_claims(n=2) x1 | 8.0 | 109.1 | $0.0000 | 6496 | new |
| playlist | FAIL FAIL | widget_present(kind=ui) x2; widget_matches(kind=ui, pattern=mzstatic\.com) x2; widget_matches(kind=ui, pattern="image":"https?://) x2 | 1.5 | 14.9 | $0.0000 | 2795 | new |
| recipe-cart | FAIL FAIL | must_call(tool=shop) x1; widget_present(kind=cart) x1; tool_arg_matches(tool=shop, pattern=tortilla\|taco shell) x1; tool_arg_matches(tool=shop, pattern=beef\|chicken\|pork\|turkey\|beans) x1; error: turn 1 timed out after 420s x1; max_tool_calls(n=8) x1; max_duration_s(n=300) x1 | 71.0 | 211.2 | $0.0000 | 239 | new |
| research | pass FAIL | must_call(tool=create_artifact) x1 | 11.0 | 83.9 | $0.0000 | 18675 | new |
| store-domain | FAIL FAIL | max_tool_calls(n=3) x1; text_matches(pattern=B&H\|bhphotovideo) x1 | 3.5 | 20.5 | $0.0000 | 2037 | new |
| trip | FAIL FAIL | widget_present(kind=ui) x2; must_call(tool=stays) x1; must_call(tool=weather) x1; widget_present(kind=stay_list) x1; widget_present(kind=weather_card) x1 | 3.5 | 27.8 | $0.0000 | 2402 | new |

Passed 4 of 24 runs.

## Failures

- car run 1
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
- car run 2
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
- dining run 1
  - max_tool_calls(n=14): 21 calls, max 14
- dining run 2
  - max_tool_calls(n=14): 24 calls, max 14
- hotel-brand run 1
  - widget_matches(kind=stay_list, pattern=€|EUR): /€|EUR/ on 1 stay_list widget(s)
  - not tool_result_matches(tool=stays, pattern=up to \$400): negated: /up to \$400/ on 1 stays result(s)
  - max_unverified_claims(n=2): 3 unverified, max 2
- hotel-brand run 2
  - widget_matches(kind=stay_list, pattern=€|EUR): /€|EUR/ on 1 stay_list widget(s)
  - not tool_result_matches(tool=stays, pattern=up to \$400): negated: /up to \$400/ on 1 stays result(s)
- india-shop run 1
  - max_tool_calls(n=12): 13 calls, max 12
- party run 1
  - widget_present(kind=cart): cart shown 0x; saw [ask, grounding_note]
  - max_unverified_claims(n=2): 8 unverified, max 2
- party run 2
  - must_call(tool=shop): shop called 0x
  - widget_present(kind=cart): cart shown 0x; saw [ui]
- party-followup run 1
  - must_call(tool=shop) @turn 1: shop called 0x
  - widget_present(kind=cart) @turn 1: cart shown 0x; saw [grounding_note]
  - must_call(tool=shop) @turn 2: shop called 0x
  - tool_arg_matches(tool=shop, pattern="qty") @turn 2: /"qty"/ on 0 shop call(s)
  - max_unverified_claims(n=2): 5 unverified, max 2
- party-followup run 2
  - widget_present(kind=cart) @turn 1: cart shown 0x; saw [ask, ui]
- playlist run 1
  - widget_present(kind=ui): ui shown 0x; saw []
  - widget_matches(kind=ui, pattern=mzstatic\.com): /mzstatic\.com/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern="image":"https?://): /"image":"https?:/// on 0 ui widget(s)
- playlist run 2
  - widget_present(kind=ui): ui shown 0x; saw []
  - widget_matches(kind=ui, pattern=mzstatic\.com): /mzstatic\.com/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern="image":"https?://): /"image":"https?:/// on 0 ui widget(s)
- recipe-cart run 1
  - must_call(tool=shop): shop called 0x
  - widget_present(kind=cart): cart shown 0x; saw []
  - tool_arg_matches(tool=shop, pattern=tortilla|taco shell): /tortilla|taco shell/ on 0 shop call(s)
  - tool_arg_matches(tool=shop, pattern=beef|chicken|pork|turkey|beans): /beef|chicken|pork|turkey|beans/ on 0 shop call(s)
- recipe-cart run 2: turn 1 timed out after 420s
  - max_tool_calls(n=8): 142 calls, max 8
  - max_duration_s(n=300): 420.0s, max 300s
- research run 2
  - must_call(tool=create_artifact): create_artifact called 0x
- store-domain run 1
  - max_tool_calls(n=3): 4 calls, max 3
- store-domain run 2
  - text_matches(pattern=B&H|bhphotovideo): /B&H|bhphotovideo/ on reply text
- trip run 1
  - widget_present(kind=ui): ui shown 0x; saw [ask, weather_card, stay_list]
- trip run 2
  - must_call(tool=stays): stays called 0x
  - must_call(tool=weather): weather called 0x
  - widget_present(kind=stay_list): stay_list shown 0x; saw [ask, flight_list]
  - widget_present(kind=weather_card): weather_card shown 0x; saw [ask, flight_list]
  - widget_present(kind=ui): ui shown 0x; saw [ask, flight_list]

## Future assertions (not counted)

- dining run 1
  - would fail: widget_present(kind=ui) (ui shown 0x; saw [])
  - would fail: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 0 ui widget(s))
- dining run 2
  - would fail: widget_present(kind=ui) (ui shown 0x; saw [])
  - would fail: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 0 ui widget(s))
- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- grocery-offlist run 2
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- hotel-brand run 2
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
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

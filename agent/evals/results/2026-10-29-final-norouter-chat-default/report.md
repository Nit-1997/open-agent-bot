# Eval report: chat-default

label: final-norouter | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | FAIL | widget_matches(kind=ui, pattern=https?://) | 1.0 (-4.5) | 2.0 | 65.6 (-12.5) | $0.0000 | 7782 (-4377) | same |
| dining | FAIL | max_tool_calls(n=14); widget_matches(kind=ui, pattern=vegetarian\|veg); widget_matches(kind=ui, pattern=reserv\|OpenTable\|Resy\|Tock) | 19.0 (-3.5) | 11.0 | 241.7 (+202.4) | $0.0000 | 17367 (+11737) | same |
| events | FAIL | widget_matches(kind=ui, pattern="type":"cards"); widget_matches(kind=ui, pattern=kid\|famil\|child); widget_matches(kind=ui, pattern=free\|\$\d) | 1.0 | 2.0 | 159.1 | $0.0000 | 6524 | new |
| gifts | pass | - | 9.0 | 10.0 | 131.8 | $0.0000 | 14812 | new |
| grocery-offlist | pass | - | 5.0 (+3.5) | 6.0 | 109.8 (+88.1) | $0.0000 | 30258 (+27810) | same |
| hotel-brand | FAIL | not tool_result_matches(tool=stays, pattern=up to \$400) | 1.0 (-1.0) | 2.0 | 20.7 (-8.2) | $0.0000 | 2217 (-4106) | same |
| india-shop | FAIL | text_matches(pattern=amazon\.in\|flipkart) | 2.0 (-7.5) | 3.0 | 134.5 (+85.2) | $0.0000 | 6618 (-4551) | REGRESSION 1/2 -> 0/1 |
| party-followup | FAIL | must_call(tool=shop) @turn 1; widget_present(kind=cart) @turn 1; must_call(tool=shop) @turn 2; tool_arg_matches(tool=shop, pattern=qty) @turn 2; text_matches(pattern=16) @turn 2 | 3.0 (-5.0) | 5.0 | 121.2 (+12.1) | $0.0000 | 2221 (-4275) | same |
| party | pass | - | 9.0 (+6.5) | 11.0 | 189.3 (+162.6) | $0.0000 | 16261 (+15190) | improved 0/2 -> 1/1 |
| playlist | FAIL | widget_present(kind=ui); widget_matches(kind=ui, pattern=mzstatic\.com); widget_matches(kind=ui, pattern="image":"https?://) | 1.0 (-0.5) | 2.0 | 12.3 (-2.6) | $0.0000 | 1598 (-1197) | same |
| recipe-cart | FAIL | must_call(tool=shop); widget_present(kind=cart); tool_arg_matches(tool=shop, pattern=tortilla\|taco shell); tool_arg_matches(tool=shop, pattern=beef\|chicken\|pork\|turkey\|beans) | 1.0 (-70.0) | 2.0 | 6.4 (-204.8) | $0.0000 | 900 (+661) | same |
| research | pass | - | 1.0 (-10.0) | 2.0 | 161.8 (+77.9) | $0.0000 | 611 (-18064) | improved 1/2 -> 1/1 |
| store-domain | FAIL | text_matches(pattern=B&H\|bhphotovideo) | 2.0 (-1.5) | 3.0 | 13.2 (-7.3) | $0.0000 | 937 (-1100) | same |
| trip | pass | - | 7.0 (+3.5) | 8.0 | 49.5 (+21.7) | $0.0000 | 5507 (+3105) | improved 0/2 -> 1/1 |

Passed 5 of 14 runs.

## Failures

- car run 1
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
- dining run 1
  - max_tool_calls(n=14): 19 calls, max 14
  - widget_matches(kind=ui, pattern=vegetarian|veg): /vegetarian|veg/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=reserv|OpenTable|Resy|Tock): /reserv|OpenTable|Resy|Tock/ on 0 ui widget(s)
- events run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=kid|famil|child): /kid|famil|child/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=free|\$\d): /free|\$\d/ on 0 ui widget(s)
- hotel-brand run 1
  - not tool_result_matches(tool=stays, pattern=up to \$400): negated: /up to \$400/ on 1 stays result(s)
- india-shop run 1
  - text_matches(pattern=amazon\.in|flipkart): /amazon\.in|flipkart/ on reply text
- party-followup run 1
  - must_call(tool=shop) @turn 1: shop called 0x
  - widget_present(kind=cart) @turn 1: cart shown 0x; saw [plan]
  - must_call(tool=shop) @turn 2: shop called 0x
  - tool_arg_matches(tool=shop, pattern=qty) @turn 2: /qty/ on 0 shop call(s)
  - text_matches(pattern=16) @turn 2: /16/ on reply text
- playlist run 1
  - widget_present(kind=ui): ui shown 0x; saw []
  - widget_matches(kind=ui, pattern=mzstatic\.com): /mzstatic\.com/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern="image":"https?://): /"image":"https?:/// on 0 ui widget(s)
- recipe-cart run 1
  - must_call(tool=shop): shop called 0x
  - widget_present(kind=cart): cart shown 0x; saw []
  - tool_arg_matches(tool=shop, pattern=tortilla|taco shell): /tortilla|taco shell/ on 0 shop call(s)
  - tool_arg_matches(tool=shop, pattern=beef|chicken|pork|turkey|beans): /beef|chicken|pork|turkey|beans/ on 0 shop call(s)
- store-domain run 1
  - text_matches(pattern=B&H|bhphotovideo): /B&H|bhphotovideo/ on reply text

## Future assertions (not counted)

- dining run 1
  - would fail: widget_present(kind=ui) (ui shown 0x; saw [])
  - would fail: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 0 ui widget(s))
- grocery-offlist run 1
  - would fail: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party-followup run 1
  - would pass: must_call(tool=plan) @turn 2 (plan called 1x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- research run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 0 load_skill call(s))
- trip run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 0 load_skill call(s))
  - would pass: must_call(tool=plan) (plan called 2x)

# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: noflags-sonnet | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | pass | - | 14.0 | 3.0 | 10.6 | $0.0443 | 8 | new |
| india-shop | FAIL | text_matches(pattern=amazon\.in\|flipkart) | 2.0 (-5.5) | 3.0 | 51.7 (+20.9) | $0.0359 (-$0.1886) | 8 (-101030) | REGRESSION 2/2 -> 0/1 |
| party-followup | pass | - | 6.0 (-1.0) | 7.0 | 48.9 (-44.5) | $0.1887 (-$0.0966) | 18 (-120253) | improved 0/2 -> 1/1 |
| research | pass | - | 2.0 (-11.0) | 3.0 | 51.9 (-1.0) | $0.0182 (-$0.3564) | 8 (-157576) | same |

Passed 3 of 4 runs.

## Failures

- india-shop run 1
  - text_matches(pattern=amazon\.in|flipkart): /amazon\.in|flipkart/ on reply text

## Future assertions (not counted)

- party-followup run 1
  - would pass: must_call(tool=plan) @turn 2 (plan called 1x)
- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))

# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m8b | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| research | pass pass | - | 6.5 (-6.5) | 6.0 | 47.3 (-5.6) | $0.0674 (-$0.3072) | 14 (-157570) | same |

Passed 2 of 2 runs.

## Future assertions (not counted)

- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
- research run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))

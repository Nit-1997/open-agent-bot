# Eval report: chat-sonnet-5.5

label: m3-brand | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| hotel-brand | FAIL FAIL | error: run error: 400: {"message":"litellm.BadRequestError: AnthropicException - b'{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\"},\"request_id\":\"req_011CgXQvUDE8EtDLfD7SnmZA\"}'\n\nLiteLLM: model group 'chat-sonnet-5.5' failed with the error above. No fallback was attempted.","type":"invalid_request_error","param":null,"code":"400"} x1; must_call(tool=stays) x2; widget_present(kind=stay_list) x2; text_matches(pattern=Marriott\|Hyatt) x2; text_matches(pattern=€\|EUR) x2; widget_matches(kind=stay_list, pattern=€\|EUR) x2; error: run error: 400: {"message":"litellm.BadRequestError: AnthropicException - b'{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\"},\"request_id\":\"req_011CgXQvUCjJE1VKmbQcG6k2\"}'\n\nLiteLLM: model group 'chat-sonnet-5.5' failed with the error above. No fallback was attempted.","type":"invalid_request_error","param":null,"code":"400"} x1 | 0.0 (-2.0) | 1.0 | 0.7 (-22.1) | $0.0000 (-$0.0838) | 0 (-35706) | same |

Passed 0 of 2 runs.

## Failures

- hotel-brand run 1: run error: 400: {"message":"litellm.BadRequestError: AnthropicException - b'{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\"},\"request_id\":\"req_011CgXQvUDE8EtDLfD7SnmZA\"}'\n\nLiteLLM: model group 'chat-sonnet-5.5' failed with the error above. No fallback was attempted.","type":"invalid_request_error","param":null,"code":"400"}
  - must_call(tool=stays): stays called 0x
  - widget_present(kind=stay_list): stay_list shown 0x; saw []
  - text_matches(pattern=Marriott|Hyatt): /Marriott|Hyatt/ on reply text
  - text_matches(pattern=€|EUR): /€|EUR/ on reply text
  - widget_matches(kind=stay_list, pattern=€|EUR): /€|EUR/ on 0 stay_list widget(s)
- hotel-brand run 2: run error: 400: {"message":"litellm.BadRequestError: AnthropicException - b'{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\"},\"request_id\":\"req_011CgXQvUCjJE1VKmbQcG6k2\"}'\n\nLiteLLM: model group 'chat-sonnet-5.5' failed with the error above. No fallback was attempted.","type":"invalid_request_error","param":null,"code":"400"}
  - must_call(tool=stays): stays called 0x
  - widget_present(kind=stay_list): stay_list shown 0x; saw []
  - text_matches(pattern=Marriott|Hyatt): /Marriott|Hyatt/ on reply text
  - text_matches(pattern=€|EUR): /€|EUR/ on reply text
  - widget_matches(kind=stay_list, pattern=€|EUR): /€|EUR/ on 0 stay_list widget(s)

## Future assertions (not counted)

- hotel-brand run 1
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 0 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 0 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 0 stays result(s))
- hotel-brand run 2
  - would fail: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 0 stays call(s))
  - would fail: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 0 stays call(s))
  - would fail: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 0 stays result(s))

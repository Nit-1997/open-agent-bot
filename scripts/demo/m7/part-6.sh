#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

load_run_env
mode() { users sql "update public.signup_settings set mode = '$1' where id returning mode"; }

step "6. the pages per signup mode (AC 19); the agent and web cache the mode 60 s, so both restart after each switch"
run stub "stub_up"
run mode-waitlist "mode waitlist"
run agent "agent_up 1 1000 1000 8 $TURNSTILE_PASS"
run web "web_up"
run browser-waitlist "browser pages-waitlist"
run mode-invite "mode invite"
run agent "agent_up 1 1000 1000 8 $TURNSTILE_PASS"
run web "web_up"
run browser-invite "browser pages-invite"

step "6. open mode: the login page, and the one-time human check with the always-pass keys (AC 18, 19)"
run mode-open "mode open"
run agent "agent_up 1 1000 1000 8 $TURNSTILE_PASS"
run web "web_up"
run users "users create h1 admin && users create h2 admin && users create h3 admin"
run browser-open "browser pages-open check-pass"

step "6. the always-fail secret, then no secret (AC 18)"
run agent "agent_up 1 1000 1000 8 $TURNSTILE_FAIL"
run browser-fail "browser check-fail"
run agent "agent_up 1 1000 1000 8"
run browser-none "browser check-none"

step "6. the mode unknown (lookup revoked after the agent started, before it read the mode): the pages show waitlist with the email-link check (AC 19)"
run agent "agent_up 1 1000 1000 8 $TURNSTILE_PASS"
run revoke "users sql \"revoke execute on function public.signup_settings_get() from service_role\" && users sql \"notify pgrst, 'reload schema'\""
run web "web_up"
run browser-unknown "browser pages-unknown"
run stop-agent-unknown "stop_bg agent"
exits agent-refuses-signup 1 "the agent refused to start: signup_settings_get is not executable (Gate 8 message above)" "agent_check local 1 1000 1000 8"
run grant "users sql \"grant execute on function public.signup_settings_get() to service_role\" && users sql \"notify pgrst, 'reload schema'\""
run mode-back "mode waitlist"

step "6. a Turnstile test secret outside local-stack mode is refused at startup (AC 18)"
run stop-agent "stop_bg agent"
exits test-secret-refused 1 "the agent refused to start outside local-stack mode (message above)" "agent_check hosted 1 1000 1000 8 $TURNSTILE_PASS"

step "6. configure-auth against the fake Management API on 127.0.0.1:18730 (AC 26)"
run configure-auth "node --test --test-reporter=spec cloud/supabase/test/configureAuth.test.mjs"

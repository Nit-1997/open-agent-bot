export const USAGE_FUNCTIONS = [
  "public.request_admit(uuid,integer,integer,timestamp with time zone)",
  "public.request_refund(uuid,bigint)",
  "public.request_usage_get(uuid,timestamp with time zone)",
  "public.request_usage_summary(timestamp with time zone)",
  "public.request_usage_page(text,integer,integer,integer,timestamp with time zone)",
  "public.request_log_prune(timestamp with time zone)",
  "public.human_check_get(uuid)",
  "public.human_check_set(uuid)",
  "public.usage_tombstone(uuid,timestamp with time zone)",
];

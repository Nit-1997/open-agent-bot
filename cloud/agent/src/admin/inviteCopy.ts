const COPY: Array<[RegExp, string]> = [
  [/rate_limit|http_429/, "Too many emails were sent recently. Wait an hour, then use Resend invite."],
  [/email_address_invalid|validation_failed|http_400|http_422/, "The email provider rejected this address. Check it for typos."],
  [/email_address_not_authorized/, "The email provider only allows test addresses. Verify a sending domain in Resend."],
  [/unreachable/, "Couldn't reach the sign-in service. Try Resend invite in a minute."],
  [
    /http_5\d\d|unexpected_failure/,
    "The email service didn't accept the invite. Check that the sending domain is verified in Resend, then use Resend invite.",
  ],
];

const FALLBACK = "The invite email couldn't be sent. Use Resend invite.";

export function describeInviteFailure(code: string): string {
  const copy = COPY.find(([pattern]) => pattern.test(code))?.[1] ?? FALLBACK;
  return `${copy} (${code})`;
}

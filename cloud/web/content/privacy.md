<!-- DRAFT-NOT-REVIEWED -->

# Privacy Policy

This policy covers the hosted Open Agent service. The app you run on your own Mac keeps everything on your Mac.

## What we store

- Your account: your email address, your name if your sign-in provider shares it, and when you signed up and last signed in.
- Your profile and settings: what you tell the agent about yourself, your default model and your agent's name and look.
- Your chats and reports, so you can come back to them.
- Model and search keys you add. They are encrypted before they are stored.
- Usage counts: how many requests you made this month and in the last hour, and whether you passed the one-time human check. We keep counts, not the messages behind them.

## What we don't store

- Your IP address. The sign-up throttle and access requests keep only a peppered hash of it.
- Card details. The service is free.

## Who else sees your data

- The model provider you pick receives your messages and the pages the agent reads for you, so it can answer.
- Supabase hosts the database and sign-in.
- Vercel serves the website.
- Cloudflare runs the human check (Turnstile) when sign-ups are open.
- Resend delivers sign-in and invite emails.

We don't sell your data and we don't use it for ads.

## Deleting your account

You can delete your account at any time from your profile. That removes your profile, chats, reports, saved keys, usage counts and sign-in account.

When you delete your account we keep a peppered hash of your email and that month's request count, for up to 2 months, so deleting and re-joining doesn't reset limits. The same record notes whether the account had passed the human check. It is only used to recognise the same address if it signs up again.

## How long we keep things

Everything else is kept while your account exists and removed when you delete it. The hourly request log is cleared within about two hours.

## Changes

We may update this policy. If a change matters, we will say so in the app before it applies.

## Contact

Privacy questions go to the address listed on the project's GitHub page.

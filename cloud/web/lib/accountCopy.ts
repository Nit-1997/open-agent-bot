export const DELETE_ACCOUNT_COPY = {
  open: "Delete my account",
  hint: "Removes your chats, reports, saved keys and profile for good.",
  title: "Delete your account?",
  body: "This deletes your chats, reports, saved keys and profile, and signs you out. It can't be undone. This month's request count stays with your email address until the month ends.",
  label: (email: string) => `Type ${email} to confirm`,
  confirm: "Delete my account",
  working: "Deleting…",
  cancel: "Cancel",
  confirmNeeded: "Type your email to confirm.",
} as const;

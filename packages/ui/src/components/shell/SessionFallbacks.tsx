export function SessionEnded() {
  return (
    <div
      id="session-ended"
      role="alert"
      className="fixed inset-x-0 top-3 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full bg-danger-bg px-4 py-2 text-sm text-danger-fg shadow-float"
    >
      <span id="session-ended-text">Your session has ended. Reload the page to sign in again.</span>
    </div>
  );
}

export function AccessEnded() {
  return (
    <main id="access-ended" className="flex h-dvh w-full flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 id="access-ended-title" role="alert" className="font-display text-[28px] leading-tight text-text-primary">
        Your access has been turned off.
      </h1>
    </main>
  );
}

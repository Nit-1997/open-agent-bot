import { Link } from "@oab/ui/platform";
import { AUTH_ERROR_COPY } from "@/lib/authErrors";

export function SignedOutBanner() {
  return (
    <div
      id="session-signed-out"
      role="alert"
      className="fixed inset-x-0 top-3 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full bg-danger-bg px-4 py-2 text-sm text-danger-fg shadow-float"
    >
      <span id="session-signed-out-text">{AUTH_ERROR_COPY.signed_out}</span>
      <Link id="session-signed-out-link" href="/login" className="rounded-full bg-charcoal px-3 py-1 text-xs font-medium text-on-charcoal">
        Sign in
      </Link>
    </div>
  );
}

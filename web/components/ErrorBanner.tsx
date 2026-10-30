import type { RunErrorKind } from "@/lib/errors";

const TEXT: Record<RunErrorKind, string> = {
  THREAD_BUSY: "Still working on the last message — wait for it to finish.",
  MODEL_ERROR: "The model hit an error.",
  UNKNOWN: "Something went wrong talking to the agent.",
};

export function ErrorBanner(props: {
  kind: RunErrorKind;
  message?: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const showRetry = props.kind === "MODEL_ERROR" || props.kind === "UNKNOWN";
  return (
    <div
      id="error-banner"
      role="alert"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl bg-danger-bg px-4 py-2.5 text-sm text-danger-fg"
    >
      <span id="error-banner-text" className="flex-1">
        {TEXT[props.kind]}
        {props.message ? ` ${props.message}` : ""}
      </span>
      {showRetry && (
        <button id="error-banner-retry" type="button" onClick={props.onRetry} className="rounded-full bg-charcoal px-3 py-1 text-xs font-medium text-on-charcoal">
          Retry
        </button>
      )}
      <button id="error-banner-dismiss" type="button" onClick={props.onDismiss} aria-label="Dismiss" className="px-2">
        ✕
      </button>
    </div>
  );
}

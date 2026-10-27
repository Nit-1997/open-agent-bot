import type { RunErrorKind } from "@/lib/errors";

const TEXT: Record<RunErrorKind, string> = {
  SESSION_EXPIRED: "This chat's session ended (the agent restarted or the chat sat idle). Start a new chat to continue.",
  THREAD_BUSY: "Still working on the last message — wait for it to finish.",
  MODEL_ERROR: "The model hit an error.",
  UNKNOWN: "Something went wrong talking to the agent.",
};

export function ErrorBanner(props: {
  kind: RunErrorKind;
  message?: string;
  onNewChat: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const showRetry = props.kind === "MODEL_ERROR" || props.kind === "UNKNOWN";
  return (
    <div
      id="error-banner"
      role="alert"
      className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <span id="error-banner-text" className="flex-1">
        {TEXT[props.kind]}
        {props.message && props.kind !== "SESSION_EXPIRED" ? ` ${props.message}` : ""}
      </span>
      {props.kind === "SESSION_EXPIRED" && (
        <button id="error-banner-new-chat" type="button" onClick={props.onNewChat} className="rounded-md bg-red-700 px-3 py-1 text-white">
          Start new chat
        </button>
      )}
      {showRetry && (
        <button id="error-banner-retry" type="button" onClick={props.onRetry} className="rounded-md bg-red-700 px-3 py-1 text-white">
          Retry
        </button>
      )}
      <button id="error-banner-dismiss" type="button" onClick={props.onDismiss} aria-label="Dismiss" className="px-2">
        ✕
      </button>
    </div>
  );
}

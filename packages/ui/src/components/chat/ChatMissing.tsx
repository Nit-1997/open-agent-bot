import { Plus } from "lucide-react";

export function ChatMissing(props: { id: string; onNewChat: () => void }) {
  const { id } = props;
  return (
    <div id={id} className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 id={`${id}-title`} className="font-display text-[28px] leading-tight text-text-primary">
        This chat doesn&apos;t exist or isn&apos;t yours.
      </h1>
      <button
        id={`${id}-new`}
        type="button"
        onClick={props.onNewChat}
        className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85"
      >
        <Plus id={`${id}-new-icon`} aria-hidden="true" size={15} />
        New chat
      </button>
    </div>
  );
}

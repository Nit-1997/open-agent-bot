import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import type { Turn } from "@/lib/turns";
import { ActivitySteps } from "./ActivitySteps";
import { Followups } from "./Followups";
import { type BrowserFrame, LiveBrowser } from "./LiveBrowser";
import { Markdown } from "./Markdown";
import { SourcesRow } from "./SourcesRow";

export function TurnView(props: {
  turn: Turn;
  running: boolean;
  locale: string;
  startedAt?: number;
  endedAt?: number;
  now: number;
  answered: boolean;
  onAnswer: (text: string) => void;
  frame?: BrowserFrame;
}) {
  const { turn, running } = props;
  const id = `turn-${turn.id}`;
  const isFollowups = (w: unknown) => (w as { kind?: string } | null)?.kind === "followups";
  const replies = turn.items.flatMap((it) => (it.kind === "widget" && isFollowups(it.widget) ? ((it.widget as { replies?: string[] }).replies ?? []) : []));
  return (
    <article id={id} className="animate-rise">
      {turn.user && (
        <div id={`${id}-user`} className="flex justify-end">
          <p id={`${id}-user-text`} className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-charcoal px-4 py-2.5 text-[15px] leading-6 text-on-charcoal">
            {turn.user.text}
          </p>
        </div>
      )}
      <div id={`${id}-agent`} className="mt-5">
        <ActivitySteps id={`${id}-steps`} steps={turn.steps} running={running} startedAt={props.startedAt} endedAt={props.endedAt} now={props.now} />
        {props.frame && <LiveBrowser id={`${id}-browser`} frame={props.frame} live={running} />}
        <div id={`${id}-body`} className="space-y-3">
          {turn.items.map((item) => {
            if (item.kind === "text") return <Markdown key={item.id} id={`${id}-md-${item.id}`} text={item.text} />;
            if (item.kind === "widget" && isFollowups(item.widget)) return null;
            if (item.kind === "widget") return <WidgetRenderer key={item.id} toolCallId={item.id} args={{ widget: item.widget }} locale={props.locale} answered={props.answered} onAnswer={props.onAnswer} />;
            if (item.result === undefined) {
              return (
                <div id={`${id}-artifact-pending-${item.id}`} key={item.id} className="h-16 animate-pulse rounded-2xl border border-border bg-surface" aria-label="Writing page" />
              );
            }
            return <ArtifactCard key={item.id} toolCallId={item.id} title={item.title} result={item.result} />;
          })}
        </div>
        {!running && <SourcesRow id={`${id}-sources`} sources={turn.sources} />}
        {!running && !props.answered && replies.length > 0 && <Followups id={`${id}-followups`} replies={replies.slice(0, 4)} onPick={props.onAnswer} />}
      </div>
    </article>
  );
}

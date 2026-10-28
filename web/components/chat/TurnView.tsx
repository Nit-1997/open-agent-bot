import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import type { Turn } from "@/lib/turns";
import { ActivitySteps } from "./ActivitySteps";
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
}) {
  const { turn, running } = props;
  const id = `turn-${turn.id}`;
  return (
    <article id={id} className="animate-rise">
      {turn.user && (
        <div id={`${id}-user`} className="flex justify-end">
          <p id={`${id}-user-text`} className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-surface px-4 py-2.5 text-[15px] leading-6 text-text-primary">
            {turn.user.text}
          </p>
        </div>
      )}
      <div id={`${id}-agent`} className="mt-5">
        <ActivitySteps id={`${id}-steps`} steps={turn.steps} running={running} startedAt={props.startedAt} endedAt={props.endedAt} now={props.now} />
        <div id={`${id}-body`} className="space-y-3">
          {turn.items.map((item) => {
            if (item.kind === "text") return <Markdown key={item.id} id={`${id}-md-${item.id}`} text={item.text} />;
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
      </div>
    </article>
  );
}

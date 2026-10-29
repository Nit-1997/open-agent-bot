import { Check } from "lucide-react";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import type { Turn } from "@/lib/turns";
import { ActivitySteps } from "./ActivitySteps";
import { Followups } from "./Followups";
import { type BrowserFrame, LiveBrowser } from "./LiveBrowser";
import type { CartEdits } from "@/components/widgets/CartCard";
import type { PlanEdits } from "@/lib/workspaceEdits";
import { Markdown } from "./Markdown";
import { SourcesRow } from "./SourcesRow";

export const QUIET_ANSWER = "answer-";
const isQuietAnswer = (messageId: string) => messageId.startsWith(QUIET_ANSWER);

export function TurnView(props: {
  turn: Turn;
  running: boolean;
  locale: string;
  startedAt?: number;
  endedAt?: number;
  now: number;
  answered: boolean;
  onAnswer: (text: string, quiet?: boolean) => void;
  frame?: BrowserFrame;
  latestCart?: string;
  onCartEdit?: (e: CartEdits) => void;
  latestPlans?: ReadonlySet<string>;
  onPlanEdit?: (e: PlanEdits) => void;
}) {
  const { turn, running } = props;
  const id = `turn-${turn.id}`;
  const isFollowups = (w: unknown) => (w as { kind?: string } | null)?.kind === "followups";
  const replies = turn.items.flatMap((it) => (it.kind === "widget" && isFollowups(it.widget) ? ((it.widget as { replies?: string[] }).replies ?? []) : []));
  return (
    <article id={id} className="animate-rise">
      {turn.user && isQuietAnswer(turn.user.id) && (
        <details id={`${id}-user`} className="group ml-auto w-fit max-w-[85%] text-right">
          <summary id={`${id}-user-summary`} className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-text-muted hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-mist-500 [&::-webkit-details-marker]:hidden">
            <Check id={`${id}-user-icon`} aria-hidden="true" size={12} />
            Sent your answers
          </summary>
          <p id={`${id}-user-text`} className="mt-1 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-left text-[12px] leading-5 text-text-secondary">
            {turn.user.text}
          </p>
        </details>
      )}
      {turn.user && !isQuietAnswer(turn.user.id) && (
        <div id={`${id}-user`} className="flex justify-end">
          <p id={`${id}-user-text`} className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-charcoal px-3.5 py-2 text-[14px] leading-[1.45] text-on-charcoal sm:rounded-[20px] sm:px-4 sm:py-2.5 sm:text-[15px] sm:leading-6">
            {turn.user.text}
          </p>
        </div>
      )}
      <div id={`${id}-agent`} className="mt-3 sm:mt-5">
        <ActivitySteps id={`${id}-steps`} steps={turn.steps} running={running} startedAt={props.startedAt} endedAt={props.endedAt} now={props.now} />
        {props.frame && <LiveBrowser id={`${id}-browser`} frame={props.frame} live={running} />}
        <div id={`${id}-body`} className="space-y-3">
          {turn.items.map((item) => {
            if (item.kind === "text") return <Markdown key={item.id} id={`${id}-md-${item.id}`} text={item.text} />;
            if (item.kind === "widget" && isFollowups(item.widget)) return null;
            if (item.kind === "widget") return <WidgetRenderer key={item.id} toolCallId={item.id} args={{ widget: item.widget }} locale={props.locale} answered={props.answered} onAnswer={(text) => props.onAnswer(text, true)} staleCart={item.id !== props.latestCart} onCartEdit={props.onCartEdit} stalePlan={!props.latestPlans?.has(item.id)} onPlanEdit={props.onPlanEdit} />;
            if (item.result === undefined) {
              return (
                <div id={`${id}-artifact-pending-${item.id}`} key={item.id} role="status" aria-label="Writing the report" className="flex h-40 animate-pulse items-center justify-center rounded-2xl border border-border bg-surface text-sm text-text-muted">
                  Writing the report…
                </div>
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

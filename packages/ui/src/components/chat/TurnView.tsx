import type { AgentPersona } from "@oab/shared/profile";
import { Check } from "lucide-react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { ReportCard } from "@/components/reports/ReportCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { parseArtifactId } from "@/lib/reportRefs";
import type { Turn } from "@/lib/turns";
import { ActivitySteps } from "./ActivitySteps";
import { Followups } from "./Followups";
import { type BrowserFrame, LiveBrowser } from "./LiveBrowser";
import type { CartEdits, PlanEdits } from "@oab/shared/workspace";
import { Markdown } from "./Markdown";
import { SourcesRow } from "./SourcesRow";

export const QUIET_ANSWER = "answer-";
const isQuietAnswer = (messageId: string) => messageId.startsWith(QUIET_ANSWER);

export function TurnView(props: {
  idPrefix: string;
  turn: Turn;
  persona: AgentPersona;
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
  arrived?: ReadonlySet<string>;
  shownAt?: Readonly<Record<string, string>>;
  openReportId?: string | null;
  reportHint?: "right" | "tap";
  onOpenReport?: (reportId: string, toolCallId: string) => void;
}) {
  const { turn, running } = props;
  const id = `${props.idPrefix}-turn-${turn.id}`;
  const isFollowups = (w: unknown) => (w as { kind?: string } | null)?.kind === "followups";
  const replies = turn.items.flatMap((it) =>
    it.kind === "widget" && isFollowups(it.widget) ? ((it.widget as { replies?: string[] }).replies ?? []) : [],
  );
  return (
    <article id={id} className="animate-rise">
      {turn.user && isQuietAnswer(turn.user.id) && (
        <details id={`${id}-user`} className="group ml-auto w-fit max-w-[85%] text-right">
          <summary
            id={`${id}-user-summary`}
            className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] text-text-muted hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-mist-500 [&::-webkit-details-marker]:hidden"
          >
            <Check id={`${id}-user-icon`} aria-hidden="true" size={12} />
            Sent your answers
          </summary>
          <p
            id={`${id}-user-text`}
            className="mt-1 whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-left text-[12px] leading-5 text-text-secondary"
          >
            {turn.user.text}
          </p>
        </details>
      )}
      {turn.user && !isQuietAnswer(turn.user.id) && (
        <div id={`${id}-user`} className="flex justify-end">
          <p
            id={`${id}-user-text`}
            className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-charcoal px-3.5 py-2 text-[14px] leading-[1.45] text-on-charcoal sm:rounded-[20px] sm:px-4 sm:py-2.5 sm:text-[15px] sm:leading-6"
          >
            {turn.user.text}
          </p>
        </div>
      )}
      <div id={`${id}-agent-row`} className="mt-3 flex gap-3 sm:mt-5">
        <AgentOrb id={`${id}-orb`} look={props.persona.look} name={props.persona.name} size={28} className="mt-0.5 hidden sm:inline-flex" />
        <div id={`${id}-agent`} className="min-w-0 flex-1">
          <ActivitySteps
            id={`${id}-steps`}
            steps={turn.steps}
            running={running}
            startedAt={props.startedAt}
            endedAt={props.endedAt}
            now={props.now}
          />
          {props.frame && <LiveBrowser id={`${id}-browser`} frame={props.frame} live={running} />}
          <div id={`${id}-body`} className="space-y-3">
            {turn.items.map((item) => {
              if (item.kind === "text") return <Markdown key={item.id} id={`${id}-md-${item.id}`} text={item.text} />;
              if (item.kind === "widget" && isFollowups(item.widget)) return null;
              if (item.kind === "widget") {
                const live = !!props.arrived?.has(item.id);
                const newest = item.id === props.latestCart || !!props.latestPlans?.has(item.id);
                return (
                  <WidgetRenderer
                    key={item.id}
                    idPrefix={props.idPrefix}
                    toolCallId={item.id}
                    args={{ widget: item.widget }}
                    locale={props.locale}
                    answered={props.answered}
                    onAnswer={(text) => props.onAnswer(text, true)}
                    staleCart={item.id !== props.latestCart}
                    onCartEdit={live ? props.onCartEdit : undefined}
                    stalePlan={!props.latestPlans?.has(item.id)}
                    onPlanEdit={live ? props.onPlanEdit : undefined}
                    lockedAt={newest && !live ? (props.shownAt?.[item.id] ?? null) : undefined}
                    agentName={props.persona.name}
                  />
                );
              }
              return (
                <ReportCard
                  key={item.id}
                  idPrefix={props.idPrefix}
                  toolCallId={item.id}
                  title={item.title}
                  result={item.result}
                  current={!!props.openReportId && parseArtifactId(item.result) === props.openReportId}
                  hint={props.reportHint ?? "right"}
                  onOpen={(reportId, toolCallId) => props.onOpenReport?.(reportId, toolCallId)}
                />
              );
            })}
          </div>
          {!running && <SourcesRow id={`${id}-sources`} sources={turn.sources} />}
          {!running && !props.answered && replies.length > 0 && (
            <Followups id={`${id}-followups`} replies={replies.slice(0, 4)} onPick={props.onAnswer} />
          )}
        </div>
      </div>
    </article>
  );
}

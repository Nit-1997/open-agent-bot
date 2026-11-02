import { AGENT_TONES, type AgentTone } from "@shared/profile";

const LABEL: Record<AgentTone, string> = { brief: "Brief", warm: "Warm", thorough: "Thorough" };
const HINT: Record<AgentTone, string> = {
  brief: "Short answers, straight to the point.",
  warm: "Friendly and personal, still concise.",
  thorough: "Fuller answers with the reasons and trade-offs.",
};

export function TonePicker(props: { id: string; name: string; value: AgentTone; onChange: (tone: AgentTone) => void }) {
  const { id } = props;
  return (
    <fieldset id={id} className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
      <legend id={`${id}-legend`} className="eyebrow mb-2 text-text-muted">
        {"How "}
        <bdi id={`${id}-legend-name`}>{props.name}</bdi>
        {" talks"}
      </legend>
      <div id={`${id}-options`} className="grid grid-cols-3 gap-2">
        {AGENT_TONES.map((tone) => {
          const on = props.value === tone;
          return (
            <button
              id={`${id}-${tone}`}
              key={tone}
              type="button"
              aria-pressed={on}
              onClick={() => props.onChange(tone)}
              className={`rounded-xl border px-2 py-2.5 text-[13px] transition ${on ? "border-charcoal bg-charcoal font-medium text-on-charcoal" : "border-border bg-surface text-text-secondary hover:border-border-strong"}`}
            >
              {LABEL[tone]}
            </button>
          );
        })}
      </div>
      <p id={`${id}-hint`} className="text-[13px] text-text-muted">
        {HINT[props.value]}
      </p>
    </fieldset>
  );
}

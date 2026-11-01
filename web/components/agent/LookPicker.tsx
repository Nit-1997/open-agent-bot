import { AGENT_LOOKS, type AgentLook } from "@shared/profile";

const LABEL: Record<AgentLook, string> = { mist: "Mist", ember: "Ember", moss: "Moss", dusk: "Dusk" };

export function LookPicker(props: { id: string; value: AgentLook; onChange: (look: AgentLook) => void }) {
  const { id } = props;
  return (
    <fieldset id={id} className="flex flex-col gap-2">
      <legend id={`${id}-legend`} className="eyebrow mb-2 text-text-muted">
        Look
      </legend>
      <div id={`${id}-options`} className="flex gap-3.5">
        {AGENT_LOOKS.map((look) => {
          const on = props.value === look;
          return (
            <button
              id={`${id}-${look}`}
              key={look}
              type="button"
              aria-pressed={on}
              aria-label={LABEL[look]}
              title={LABEL[look]}
              data-look={look}
              onClick={() => props.onChange(look)}
              className={`orb h-11 w-11 border-2 transition ${on ? "border-text-primary" : "border-transparent hover:border-border-strong"}`}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

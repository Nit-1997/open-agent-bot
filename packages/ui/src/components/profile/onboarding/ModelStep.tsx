"use client";

import type { ModelList } from "@/lib/models";
import { ModelOptions } from "../ModelOptions";
import { ProvidersList } from "../ModelsPanel";

export function ModelStep(props: {
  id: string;
  models: ModelList | null;
  value: string | undefined;
  onChange: (id: string) => void;
  onProvidersChanged: () => void;
  adding: boolean;
  onAdding: (v: boolean) => void;
}) {
  const hasModels = !!props.models?.models.length;
  if (!hasModels || props.adding) {
    return (
      <div id={props.id} className="space-y-3">
        {hasModels && (
          <button
            id={`${props.id}-done-adding`}
            type="button"
            onClick={() => props.onAdding(false)}
            className="text-xs text-mist-600 underline underline-offset-2"
          >
            ← Back to the model list
          </button>
        )}
        <div id={`${props.id}-providers`} className="max-h-[46vh] overflow-y-auto pr-1">
          <ProvidersList onChanged={props.onProvidersChanged} />
        </div>
      </div>
    );
  }
  return (
    <div id={props.id} className="space-y-3">
      <div id={`${props.id}-list`} className="max-h-[46vh] overflow-y-auto pr-1">
        <ModelOptions id={`${props.id}-options`} models={props.models} value={props.value} onChange={props.onChange} />
      </div>
      <button
        id={`${props.id}-add-provider`}
        type="button"
        onClick={() => props.onAdding(true)}
        className="text-xs text-mist-600 underline underline-offset-2"
      >
        Add another provider
      </button>
    </div>
  );
}

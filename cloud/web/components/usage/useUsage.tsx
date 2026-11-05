"use client";

import { useRunSettled } from "@oab/ui/platform";
import { api } from "@oab/ui/platform/api";
import type { HumanCheckState, UsageView } from "@oab/shared/usage";
import { useCallback, useEffect, useState } from "react";

export type UsageState = { kind: "loading" } | { kind: "ready"; view: UsageView } | { kind: "unavailable" };

const HUMAN_CHECK: readonly HumanCheckState[] = ["off", "required", "done", "unavailable"];

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isInstant = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseUsageView(body: unknown): UsageView | undefined {
  if (!isRecord(body) || !isRecord(body.month) || !isRecord(body.hour) || !isRecord(body.running)) return undefined;
  const { month, hour, running, humanCheck } = body;
  if (!isCount(month.used) || !isCount(month.limit) || month.limit < 1 || !isInstant(month.resetsAt)) return undefined;
  if (!isCount(hour.used) || !isCount(hour.limit) || !(hour.resetsAt === null || isInstant(hour.resetsAt))) return undefined;
  if (!isCount(running.mine) || !isCount(running.limit)) return undefined;
  if (!HUMAN_CHECK.includes(humanCheck as HumanCheckState)) return undefined;
  return {
    month: { used: month.used, limit: month.limit, resetsAt: month.resetsAt },
    hour: { used: hour.used, limit: hour.limit, resetsAt: hour.resetsAt },
    running: { mine: running.mine, limit: running.limit },
    humanCheck: humanCheck as HumanCheckState,
  };
}

async function fetchUsage(signal: AbortSignal): Promise<UsageState> {
  try {
    const res = await api().fetch("/usage", { cache: "no-store", signal });
    if (!res.ok) return { kind: "unavailable" };
    const view = parseUsageView(await res.json());
    return view && view.humanCheck !== "unavailable" ? { kind: "ready", view } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export function useUsage(): { state: UsageState; retry: () => void } {
  const settled = useRunSettled();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<UsageState>({ kind: "loading" });
  useEffect(() => {
    const ac = new AbortController();
    void fetchUsage(ac.signal).then((next) => {
      if (!ac.signal.aborted) setState(next);
    });
    return () => ac.abort();
  }, [settled, attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}

type RunStats = {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  costUsd: number;
  jevCalls: number;
  jevCostUsd: number;
  toolCalls: number;
  llmTurns: number;
  durationMs: number;
  skills: string[];
};

export type Usage = { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } };

export function createStatsCollector(now: () => number = Date.now) {
  const startedAt = now();
  const totals = { inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0, toolCalls: 0, llmTurns: 0 };
  const script = { calls: 0, costUsd: 0 };
  const skills: string[] = [];
  return {
    usage(u: Usage) {
      totals.inputTokens += u.input ?? 0;
      totals.outputTokens += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.costUsd += u.cost?.total ?? 0;
      totals.llmTurns++;
    },
    scriptCost(u: Usage) {
      script.costUsd += u.cost?.total ?? 0;
    },
    scriptCalls(result: unknown) {
      const calls = (result as { details?: { calls?: { name?: string }[] } } | undefined)?.details?.calls;
      script.calls += (calls ?? []).filter((c) => c.name?.startsWith("models.")).length;
    },
    toolStart(name: string, args: unknown) {
      totals.toolCalls++;
      const skill = (args as { name?: unknown } | undefined)?.name;
      if (name === "load_skill" && typeof skill === "string" && !skills.includes(skill)) skills.push(skill);
    },
    snapshot(turn?: { jevCalls: number; jevCostUsd: number }): RunStats {
      return {
        ...totals,
        jevCalls: (turn?.jevCalls ?? 0) + script.calls,
        jevCostUsd: (turn?.jevCostUsd ?? 0) + script.costUsd,
        durationMs: now() - startedAt,
        skills: [...skills],
      };
    },
  };
}

export type StatsCollector = ReturnType<typeof createStatsCollector>;

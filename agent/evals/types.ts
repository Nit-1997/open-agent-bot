export type Assertion = { type: string; turn?: number; [key: string]: unknown };

export type Scenario = {
  id: string;
  proves: string[];
  context: { timeZone: string; locale: string; home: string };
  turns: Array<{ prompt: string; if_asked?: string }>;
  assert: Assertion[];
  future_assert: Assertion[];
};

export type RunStats = {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  costUsd: number;
  jevCalls: number;
  jevCostUsd: number;
  toolCalls: number;
  durationMs: number;
  skills: string[];
};

export type ToolRecord = { name: string; args: unknown; result: string; isError?: boolean };
export type WidgetRecord = { kind: string; json: string };

export type TurnRecord = {
  prompt: string;
  tools: ToolRecord[];
  widgets: WidgetRecord[];
  unverifiedClaims: number;
  text: string;
  askedUser: boolean;
  durationMs: number;
  stats?: RunStats;
  error?: string;
};

export type AssertionResult = { label: string; ok: boolean; detail: string };

export type RunRecord = {
  scenario: string;
  model: string;
  run: number;
  threadId: string;
  turns: TurnRecord[];
  error?: string;
  passed: boolean;
  failed: AssertionResult[];
  future: AssertionResult[];
};

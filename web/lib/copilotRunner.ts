import { AsyncLocalStorage } from "node:async_hooks";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { AgentAuth } from "@/lib/auth";

const requestAuth = new AsyncLocalStorage<AgentAuth>();

export function withRequestAuth<T>(auth: AgentAuth, fn: () => T): T {
  return requestAuth.run(auth, fn);
}

export function requestAgentAuth(): AgentAuth {
  const auth = requestAuth.getStore();
  if (!auth) throw new Error("The chat runner was used outside a signed-in request.");
  return auth;
}

export function scopedThreadId(threadId: string): string {
  return `${requestAgentAuth().userId}:${threadId}`;
}

// InMemoryAgentRunner keys its process-wide store by bare thread id and advertises local thread
// endpoints that list every thread; this wrapper keys by user and exposes neither.
export class UserScopedRunner extends AgentRunner {
  private readonly inner = new InMemoryAgentRunner();

  run(request: AgentRunnerRunRequest) {
    return this.inner.run({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  connect(request: AgentRunnerConnectRequest) {
    return this.inner.connect({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  isRunning(request: AgentRunnerIsRunningRequest) {
    return this.inner.isRunning({ ...request, threadId: scopedThreadId(request.threadId) });
  }

  stop(request: AgentRunnerStopRequest) {
    return this.inner.stop({ ...request, threadId: scopedThreadId(request.threadId) });
  }
}

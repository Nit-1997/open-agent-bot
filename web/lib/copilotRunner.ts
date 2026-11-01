import { AsyncLocalStorage } from "node:async_hooks";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";

const requestUser = new AsyncLocalStorage<string>();

export function withRunnerUser<T>(userId: string, fn: () => T): T {
  return requestUser.run(userId, fn);
}

export function scopedThreadId(threadId: string): string {
  const userId = requestUser.getStore();
  if (!userId) throw new Error("The chat runner was used outside a signed-in request.");
  return `${userId}:${threadId}`;
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

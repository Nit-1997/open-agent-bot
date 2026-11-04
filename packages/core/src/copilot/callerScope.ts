import { AsyncLocalStorage } from "node:async_hooks";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { Principal } from "../identity/types.js";

const caller = new AsyncLocalStorage<Principal>();

export function withCaller<T>(principal: Principal, fn: () => T): T {
  return caller.run(principal, fn);
}

export function currentCaller(): Principal {
  const principal = caller.getStore();
  if (!principal) throw new Error("The chat runtime was used outside a signed-in request.");
  return principal;
}

export const scopedThreadId = (threadId: string) => `${currentCaller().id}:${threadId.toLowerCase()}`;

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

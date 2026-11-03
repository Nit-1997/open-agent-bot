import { AbstractAgent, type BaseEvent, EventType, type RunAgentInput, type RunAgentResult } from "@ag-ui/client";
import { Observable } from "rxjs";
import { type RunDeps, type RunHandle, type StartRunOptions, type StartRunResult, startRun } from "../agui/startRun.js";
import { errorBody, errorStatus } from "../http/handlers.js";
import type { Principal } from "../identity/types.js";
import type { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import type { ThreadOwners } from "./owners.js";

export type StartRun = (principal: Principal, input: RunAgentInput, opts: StartRunOptions) => Promise<StartRunResult>;

export type CoreRunAgentOptions = Readonly<{
  principal: Principal;
  start: StartRun;
  onClaimed?: (threadId: string) => void;
}>;

const ABORTED = "This operation was aborted";

function httpError(status: number, payload: unknown): Error & { status: number; payload: unknown } {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Object.assign(new Error(`HTTP ${status}: ${text}`), { status, payload });
}

const refusal = (err: UserError) => httpError(errorStatus(err), errorBody(err));

const abortError = () => new DOMException(ABORTED, "AbortError");

const abortEvent = (): BaseEvent => ({ type: EventType.RUN_ERROR, message: ABORTED, code: "abort" }) as BaseEvent;

const wireCopy = (event: BaseEvent): BaseEvent => JSON.parse(JSON.stringify(event)) as BaseEvent;

export class CoreRunAgent extends AbstractAgent {
  private options: CoreRunAgentOptions;
  private abortController = new AbortController();

  constructor(options: CoreRunAgentOptions) {
    super();
    this.options = options;
  }

  runAgent(...args: Parameters<AbstractAgent["runAgent"]>): Promise<RunAgentResult> {
    this.abortController = new AbortController();
    return super.runAgent(...args);
  }

  abortRun(): void {
    this.abortController.abort();
    super.abortRun();
  }

  clone(): CoreRunAgent {
    const cloned = super.clone() as CoreRunAgent;
    cloned.options = this.options;
    cloned.abortController = new AbortController();
    if (this.abortController.signal.aborted) cloned.abortController.abort();
    return cloned;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const { principal, start, onClaimed } = this.options;
    const signal = this.abortController.signal;
    return new Observable<BaseEvent>((subscriber) => {
      let handle: RunHandle | undefined;
      let dropped = false;

      const pump = async (run: RunHandle) => {
        const aborted = new Promise<"aborted">((resolve) => {
          if (signal.aborted) resolve("aborted");
          else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
        });
        try {
          for (;;) {
            const next = await Promise.race([run.events.next(), aborted]);
            if (dropped) return;
            if (next === "aborted") {
              subscriber.next(abortEvent());
              break;
            }
            if (next.done) break;
            subscriber.next(wireCopy(next.value));
          }
          subscriber.complete();
        } catch (err) {
          if (!dropped) subscriber.error(err);
        } finally {
          run.close();
        }
      };

      void (async () => {
        let started: StartRunResult;
        try {
          started = await start(principal, input, { signal, ...(onClaimed && { onClaimed }) });
        } catch (err) {
          log.error(`[copilot] user=${principal.id} run failed to start`, err);
          if (!dropped) subscriber.error(httpError(500, "Internal Server Error"));
          return;
        }
        if (!started.ok) {
          if (!dropped) subscriber.error(refusal(started.error));
          return;
        }
        handle = started.run;
        if (dropped) return handle.close();
        if (signal.aborted) {
          handle.close();
          return subscriber.error(abortError());
        }
        await pump(handle);
      })();

      return () => {
        dropped = true;
        handle?.close();
      };
    });
  }
}

export function coreAgentFactory(deps: { run: RunDeps; owners: ThreadOwners }): (principal: Principal) => CoreRunAgent {
  const start: StartRun = (principal, input, opts) => startRun(deps.run, principal, input, opts);
  return (principal) => new CoreRunAgent({ principal, start, onClaimed: (threadId) => deps.owners.claim(threadId, principal.id) });
}

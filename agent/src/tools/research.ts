import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ImageCheck } from "../artifacts/images.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { Evidence } from "../grounding/evidence.js";
import { type Judge, noJudge } from "../judge/index.js";
import type { Complete } from "../workflows/llm.js";
import { runResearch, type WorkflowStep } from "../workflows/research.js";
import { queryList } from "./args.js";
import { storeArtifact } from "./createArtifact.js";
import { fetchPageTool } from "./fetchPage.js";
import { fail, ok, type ToolResult } from "./result.js";
import { search as runSearch } from "./webSearch.js";

type Deps = {
  search: { searxngUrl: string; braveApiKey?: string; fetch?: typeof fetch };
  artifacts: ArtifactStore;
  images?: ImageCheck;
  complete: Complete;
  judge?: Judge;
  evidence?: Evidence;
  fetchPage?: ReturnType<typeof fetchPageTool>;
};

export const WORKFLOW_STEP = "workflowStep";

export function researchTool(deps: Deps) {
  const page = deps.fetchPage ?? fetchPageTool();
  return defineTool({
    name: "research",
    label: "Research report",
    description:
      "Research a question end to end and publish a report whose claims are checked against its sources. Searches the web, reads the best pages, plans and writes the report, then verifies each claim against the page it cites. Call it once for any report, comparison, or 'should I buy X' decision, instead of searching, reading, and calling create_artifact yourself. The report is shown inline; reply in two or three sentences with the takeaway.",
    parameters: Type.Object({
      question: Type.String({ minLength: 1, description: "what the report should answer, with the user's constraints" }),
      queries: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()], { description: "up to 4 web searches covering different angles; defaults to the question" })),
      decision: Type.Optional(Type.String({ description: "the decision the report supports, e.g. which one to buy" })),
      audience: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, onUpdate): Promise<ToolResult> {
      const emit = (step: WorkflowStep) => onUpdate?.({ content: [{ type: "text", text: step.phase }], details: { [WORKFLOW_STEP]: step } });
      const outcome = await runResearch(
        { question: params.question, queries: queryList(params.queries), decision: params.decision, audience: params.audience },
        {
          search: (q, s) => runSearch(deps.search, q, "web", 8, s),
          read: async (url, s) => {
            const r = (await page.execute("research", { url }, s, undefined, undefined as never)) as ToolResult;
            if (r.isError) return null;
            const text = r.content.map((c) => c.text).join("");
            deps.evidence?.add(text);
            return text.replace(/^url: .*\n\n/, "");
          },
          complete: deps.complete,
          judge: deps.judge ?? noJudge,
          publish: async (title, html) => {
            const r = await storeArtifact(deps.artifacts, deps.images, title, html);
            const id = r.details.artifactId;
            return r.isError || typeof id !== "string" ? { error: r.content[0]?.text ?? "could not save the report" } : { id };
          },
          emit,
          signal,
        },
      );
      if (!outcome.ok) return fail(`research failed: ${outcome.error}. Continue yourself with web_search, fetch_page and create_artifact.`);
      const checks = `${outcome.total} claims checked against their sources: ${outcome.supported} supported, ${outcome.flagged} flagged as unverified in the report${outcome.unchecked ? `, ${outcome.unchecked} not checked` : ""}.`;
      return ok(`artifact ${outcome.id} created: ${outcome.title}\nRead ${outcome.sources} sources. ${checks}\nTakeaway: ${outcome.takeaway}\nThe report is shown to the user. Reply in two or three sentences with the takeaway${outcome.flagged || outcome.unchecked ? " and say how many claims could not be confirmed" : ""}.`, { artifactId: outcome.id, title: outcome.title });
    },
  });
}

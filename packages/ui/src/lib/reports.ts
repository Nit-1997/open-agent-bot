import { api } from "../platform/api.ts";
import type { ReportSummary } from "@oab/shared/lists";
import type { PageResponse } from "@oab/shared/pages";
import { readApi } from "./api.ts";

export const reportsApi = {
  page: async (page: number, signal?: AbortSignal) =>
    readApi<PageResponse<ReportSummary>>(await api().fetch(`/reports?page=${page}`, { cache: "no-store", signal })),
  get: async (id: string, signal?: AbortSignal) =>
    readApi<{ report: ReportSummary }>(await api().fetch(`/reports/${encodeURIComponent(id)}`, { cache: "no-store", signal })),
};

const artifactPath = (id: string) => `/artifacts/${encodeURIComponent(id)}` as const;

export const reportPdfHref = (id: string) => api().url(`${artifactPath(id)}?format=pdf`);
export const reportHtmlHref = (id: string) => api().url(artifactPath(id));
export const reportThumbHref = (id: string) => api().url(`${artifactPath(id)}?format=thumb`);

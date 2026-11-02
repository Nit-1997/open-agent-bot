import type { ReportSummary } from "@shared/lists";
import type { PageResponse } from "@shared/pages";
import { readApi } from "@/lib/api";

export const reportsApi = {
  page: async (page: number, signal?: AbortSignal) =>
    readApi<PageResponse<ReportSummary>>(await fetch(`/api/reports?page=${page}`, { cache: "no-store", signal })),
  get: async (id: string, signal?: AbortSignal) =>
    readApi<{ report: ReportSummary }>(await fetch(`/api/reports/${encodeURIComponent(id)}`, { cache: "no-store", signal })),
};

export const reportPdfHref = (id: string) => `/api/artifacts/${id}?format=pdf`;
export const reportHtmlHref = (id: string) => `/api/artifacts/${id}`;
export const reportThumbHref = (id: string) => `/api/artifacts/${id}?format=thumb`;

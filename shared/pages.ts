export const PAGE_SIZE = 5;

export type Page<T> = { items: T[]; total: number };

export type PageResponse<T> = Page<T> & { page: number; pageSize: number };

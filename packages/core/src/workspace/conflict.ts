export class VersionConflict extends Error {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`${kind} ${id} is at version ${actual}, not ${expected}`);
  }
}

export class WorkspaceFull extends Error {
  constructor(readonly limit: number) {
    super(`This session already holds ${limit} plans. Update one of them instead of adding another.`);
  }
}

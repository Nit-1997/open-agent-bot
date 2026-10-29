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

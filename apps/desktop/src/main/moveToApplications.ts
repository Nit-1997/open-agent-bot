export function needsMovePrompt(o: {
  packaged: boolean;
  test: boolean;
  fakeOutside: boolean;
  inApplications: boolean;
  keepOutside: boolean;
}): boolean {
  if (o.keepOutside) return false;
  if (o.test) return o.fakeOutside;
  return o.packaged && !o.inApplications;
}

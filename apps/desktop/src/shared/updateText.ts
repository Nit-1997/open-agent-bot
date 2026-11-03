const INCOMPATIBLE: Readonly<Record<string, string>> = {
  compose_mismatch: "it needs a different compose file; update Open Agent first",
  shell_too_old: "it needs a newer Open Agent",
  min_shell_version: "it doesn't say which Open Agent it needs",
  manifest_tag_mismatch: "its version doesn't match the release",
  release_refs: "its images are not from Open Agent's registry",
  test_refs: "its images are not test images",
  manifest_kind: "it is not a release manifest",
  dev_outside_test: "it is not a release manifest",
  asset_url: "it isn't a download from Open Agent's releases",
};

export const incompatibleText = (reason: string): string =>
  `Service update not compatible: ${INCOMPATIBLE[reason] ? `${INCOMPATIBLE[reason]} (${reason})` : reason}`;

import { ARTIFACT_SANDBOX } from "@oab/shared/artifacts";
import type { Ref } from "react";
import { reportHtmlHref } from "@/lib/reports";

export function ArtifactFrame({
  ref,
  ...props
}: {
  id: string;
  artifactId: string;
  title: string;
  className: string;
  onLoad?: () => void;
  ref?: Ref<HTMLIFrameElement>;
}) {
  return (
    <iframe
      id={props.id}
      ref={ref}
      title={props.title}
      sandbox={ARTIFACT_SANDBOX}
      src={reportHtmlHref(props.artifactId)}
      onLoad={props.onLoad}
      className={props.className}
    />
  );
}

import { ARTIFACT_SANDBOX } from "@shared/artifacts";
import type { Ref } from "react";
import { reportHtmlHref } from "@/lib/reports";

export function ArtifactFrame({
  ref,
  ...props
}: {
  id: string;
  artifactId: string;
  title: string;
  lazy?: boolean;
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
      loading={props.lazy ? "lazy" : undefined}
      onLoad={props.onLoad}
      className={props.className}
    />
  );
}

import { ARTIFACT_SANDBOX } from "@shared/artifacts";
import { reportHtmlHref } from "@/lib/reports";

export function ArtifactFrame(props: { id: string; artifactId: string; title: string; lazy?: boolean; className: string }) {
  return (
    <iframe
      id={props.id}
      title={props.title}
      sandbox={ARTIFACT_SANDBOX}
      src={reportHtmlHref(props.artifactId)}
      loading={props.lazy ? "lazy" : undefined}
      className={props.className}
    />
  );
}

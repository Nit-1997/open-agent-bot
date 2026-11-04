import type { ArtifactFile } from "@oab/core/store/types.js";

export const ARTIFACTS_BUCKET = "artifacts";

export const artifactPath = (userId: string, id: string, file: ArtifactFile) => `${userId}/${id}.${file}`;

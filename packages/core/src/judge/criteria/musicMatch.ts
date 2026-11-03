import type { ChooseCriteria } from "../index.js";

export const musicMatch: ChooseCriteria & { none: string } = {
  id: "musicMatch",
  version: "1",
  question:
    "A listener asked for a song or album. Pick the catalog entry that is the same work by the same artist. Skip tributes, karaoke, covers by other artists, 'originally performed by' versions, and remixes unless the request asks for one. When an album was asked for, skip compilations, greatest-hits sets and live albums unless the request names them. Prefer the original release over a live version, and the standard edition over a deluxe or remastered extra when both exist.",
  none: "No entry is the requested work by the requested artist.",
};

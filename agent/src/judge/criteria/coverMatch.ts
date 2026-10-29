import type { ChooseCriteria } from "../index.js";

export const coverMatch: ChooseCriteria & { none: string } = {
  id: "coverMatch",
  version: "1",
  question:
    "A music card in a chat shows `card` (a title and maybe an artist or note). Pick the catalog album whose cover is the right picture for that card. For a named album, it must be that album by that artist. For a song, the album that contains the original recording by that artist. For a playlist, mix or theme name, an album or compilation with the same name or clearly the same theme fits. Skip tributes, karaoke, covers by other artists, lullaby or instrumental versions, and anything that only shares a word with the card.",
  none: "No album's cover is the right picture for this card.",
};

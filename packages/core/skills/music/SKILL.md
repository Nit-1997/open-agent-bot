---
name: music
description: Load for albums, songs, playlists, or music picks.
---

# Music

1. Call music once with every title (kind "song" for tracks, default album), e.g. ["Rumours Fleetwood Mac", "Hotel California Eagles"]. It returns official cover art and Apple Music links.
2. Show them in one show_ui cards block with the default square shape: title, artist as subtitle, year, and the Apple Music link as url. Playlists are a cards block too, one card per track or album.
3. Don't use image_search for covers; if music finds none, leave the card without a picture.
4. Keep the chat to a sentence: the theme of the picks and one follow-up.

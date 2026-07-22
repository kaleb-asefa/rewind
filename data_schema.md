# Data Schema — Spotify Extended Streaming History

## Where this data comes from
Requested from Spotify's Privacy settings page as **Extended streaming
history** (not the smaller "Account data" package, which only covers the
last ~90 days). Turnaround can take up to 30 days; no documented limit on
how often you can request it, but in practice once every few months is
realistic given processing time.

## Files you get
- `Streaming_History_Audio_<range>.json` — one or more files, split by date
  range, covering music/audio streams
- `Streaming_History_Video_<range>.json` — video streams. **Can be non-empty
  even if you never intentionally watched a video** — see gotchas below.

Both files share the same underlying schema.

## Field reference

**Timing / session**
| Field | Meaning |
|---|---|
| `ts` | UTC timestamp when the stream ended |
| `ms_played` | Milliseconds actually played |
| `offline` / `offline_timestamp` | Whether played offline |
| `reason_start` | Why playback started (see below) |
| `reason_end` | Why playback stopped (same value set as `reason_start`) |
| `shuffle` | Whether shuffle was on |
| `skipped` | Boolean — whether the stream was skipped |
| `incognito_mode` | Whether played in private session |

**`reason_start` / `reason_end` values**
| Value | Meaning |
|---|---|
| `clickrow` | Manually clicked/tapped the track in a list |
| `fwdbtn` | Skip-forward button |
| `backbtn` | Previous-track button |
| `appload` | App opened, track resumed as a result |
| `trackdone` | Previous track finished naturally, this one autoplayed next |
| `playbtn` | Main play button (resume from pause, or play on album/playlist page) |
| `remote` | Started via Spotify Connect / remote / another device controlling playback |
| `trackerror` | Previous track errored out, playback moved on |
| `unknown` | Spotify didn't log a specific trigger |

**Device / connection**
| Field | Meaning |
|---|---|
| `platform` | e.g. `android`, `osx`, `ios` |
| `conn_country` | Country code at time of stream |
| `ip_addr_decrypted` | IP address — sensitive, see note below |
| `user_agent_decrypted` | Browser/app user agent |

**Content metadata**
| Field | Meaning |
|---|---|
| `master_metadata_track_name` | Track/video title |
| `master_metadata_album_artist_name` | Artist/creator |
| `master_metadata_album_album_name` | Album, if applicable |
| `spotify_track_uri` | Spotify URI (`spotify:track:...`) |
| `episode_name` / `episode_show_name` | Populated instead of the above if it's a podcast episode |
| `audiobook_title` / `audiobook_uri` | Populated for audiobook entries |

## Gotchas

- **Null metadata fields**: some entries have `null` track/artist metadata —
  this happens for tracks that have since been removed or delisted from
  Spotify, even though `ms_played` still recorded correctly. Filter or
  handle these before aggregating.
- **The "Video" file isn't necessarily about music videos.** Spotify has
  been rolling out video versions of podcast episodes. If a podcast you
  streamed had a video track (even played with the screen off or app
  backgrounded), it gets logged as a video stream. Check whether entries
  have `episode_name`/`episode_show_name` populated (→ video podcast) vs.
  `master_metadata_track_name`/`master_metadata_album_artist_name` (→ an
  actual music video).
- **Privacy**: `ip_addr_decrypted` and `user_agent_decrypted` are sensitive.
  If this project ever supports other users uploading their own export,
  these fields should be stripped client-side or never persisted server-side.
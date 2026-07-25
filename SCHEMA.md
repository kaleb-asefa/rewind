# Rewind — Data Schema

## Status

Documents the `history` table structure for ingesting Spotify's Extended Streaming History export. Spotify-only for now — as the project grows, sections for a `users` table, leaderboard tables, etc. will be added here rather than in a new file.

## Source Data

Spotify's export delivers one JSON record per stream event, covering both music tracks (`end_song`) and podcast episodes (`end_video`). Each record carries around two dozen fields describing the stream: timestamp, platform, playback duration, geographic/network metadata, track/artist/album identifiers, podcast identifiers, and playback-behavior flags (shuffle, skip, offline, incognito).

Approach: store everything except the two fields that are a genuine privacy liability. Bringing in a field later that wasn't captured at ingestion means re-processing every user's export from scratch — cheap now, expensive later. The only fields excluded are ones with no analytical value that also carry real privacy risk.

## Column Decisions

| Spotify Field | Store? | Rewind Column | Type | Reason |
|---|---|---|---|---|
| `ts` | ✅ Yes | `ts` | `TIMESTAMP` | Heatmap, active-days count, date-range filtering. |
| `username` | ✅ Yes | `username` | `VARCHAR` | Not sensitive in the way IP/user-agent are — useful once multi-user support exists. |
| `platform` | ✅ Yes | `platform` | `VARCHAR` | Enables a future "listening by device" breakdown. |
| `ms_played` | ✅ Yes | `ms_played` | `BIGINT` | Total listening time (in milliseconds). |
| `conn_country` | ✅ Yes | `conn_country` | `VARCHAR` | Enables a future "listening by country" view (useful for users who travel). |
| `master_metadata_track_name` | ✅ Yes | `track_name` | `VARCHAR` | Top track / most-skipped track. |
| `master_metadata_album_artist_name` | ✅ Yes | `artist_name` | `VARCHAR` | Top artist / most-skipped artist. |
| `master_metadata_album_album_name` | ✅ Yes | `album_name` | `VARCHAR` | Top album. |
| `spotify_track_uri` | ✅ Yes | `track_uri` | `VARCHAR` | Stable unique identifier — used for de-duplication across multiple export files and for counting unique songs (more reliable than matching on track name, since names collide across artists). |
| `episode_name` | ✅ Yes | `episode_name` | `VARCHAR` | Reserved for future podcast-analytics metrics. |
| `episode_show_name` | ✅ Yes | `episode_show_name` | `VARCHAR` | Reserved for future podcast-analytics metrics. |
| `spotify_episode_uri` | ✅ Yes | `episode_uri` | `VARCHAR` | Reserved for future podcast-analytics metrics; unique key for episodes. |
| `reason_start` | ✅ Yes | `reason_start` | `VARCHAR` | Reserved — more detailed skip/replay analysis later. |
| `reason_end` | ✅ Yes | `reason_end` | `VARCHAR` | Reserved — more detailed skip/replay analysis later. |
| `shuffle` | ✅ Yes | `shuffle` | `BOOLEAN` | Reserved for future listening-habit metrics. |
| `skipped` | ✅ Yes | `skipped` | `BOOLEAN` | Most-hated artist / most-hated track. |
| `offline` | ✅ Yes | `offline` | `BOOLEAN` | Reserved for future listening-habit metrics. |
| `offline_timestamp` | ✅ Yes | `offline_timestamp` | `TIMESTAMP` | Reserved — pairs with `offline`. |
| `incognito_mode` | ✅ Yes | `incognito_mode` | `BOOLEAN` | Reserved for future listening-habit metrics. |
| `ip_addr_decrypted` | ❌ No | — | — | Personal network data. No analytical use case justifies the privacy risk. Excluded entirely — never selected at ingestion, never written to disk. |
| `user_agent_decrypted` | ❌ No | — | — | Personal device/browser fingerprint data. Same treatment as IP — excluded at ingestion. |

## Resulting `history` Table

```sql
CREATE TABLE history (
    ts                 TIMESTAMP,
    username           VARCHAR,
    platform           VARCHAR,
    ms_played          BIGINT,
    conn_country       VARCHAR,
    track_name         VARCHAR,
    artist_name        VARCHAR,
    album_name         VARCHAR,
    track_uri          VARCHAR,
    episode_name       VARCHAR,
    episode_show_name  VARCHAR,
    episode_uri        VARCHAR,
    reason_start       VARCHAR,
    reason_end         VARCHAR,
    shuffle            BOOLEAN,
    skipped            BOOLEAN,
    offline            BOOLEAN,
    offline_timestamp  TIMESTAMP,
    incognito_mode     BOOLEAN
);
```

Ingestion selects all of the above from the raw JSON via explicit schema normalization (`TRY_CAST({col} AS {dtype})` for existing columns and `CAST(NULL AS {dtype})` for absent keys across multiple JSON export files; see `BACKEND.md` for the ingestion/query pattern). `ip_addr_decrypted` and `user_agent_decrypted` are the only two fields never read into memory as table columns in the first place.

## Future Growth

This file currently covers Spotify listening data only. As the project grows to support user accounts, leaderboards, or other features, those will get their own schema sections here (or their own files, following the same pattern as `design.md` / `BACKEND.md`) — not bolted onto the `history` table.

# Saaya Telegram Bot (Railway)

## Deploy

Put `index.js`, `package.json`, and `railpack.json` in the Railway service root. `railpack.json` installs `yt-dlp` and `ffmpeg` at runtime. `nixpacks.toml` is included only as a fallback for a service that still uses the legacy Nixpacks builder. Set the environment variables below in Railway; do not commit secret values to GitHub.

## Environment variables

- `TELEGRAM_BOT_TOKEN` — required Telegram bot token.
- `GEMINI_API_KEY` — required Gemini text/chat API key. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`.
- `BOT_OWNER_ID` — owner's numeric Telegram user ID; the bot uses exact ID comparison for owner recognition. `OWNER_HANDLE` is display text only.
- `YOUTUBE_API_KEY` — YouTube Data API v3 key, required for `/yt` search results.
- `GOOGLE_TTS_API_KEY` — Google Cloud Text-to-Speech key, required for `/say`.
- `GOOGLE_TTS_VOICE_NAME` — optional; defaults to `hi-IN-Standard-A`.
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` — for `/image`.
- Optional: `OWNER_CHAT_ID`, `OWNER_HANDLE`, `BOT_NAME`, `GROUP_TRIGGER`, `DATA_FILE`.

Enable YouTube Data API v3 and Cloud Text-to-Speech in Google Cloud as needed, and restrict each key to its relevant API. Keep API keys as Railway Variables.

## Restored and current features

- `/joke [topic]`, `/style friendly|balanced|savage`, `/voice [voice ID|default]`, `/say <text>`.
- `/yt <search>` shows result thumbnails/titles; send a result number, then `MP3` or `MP4`.
- `/ytmp3 <YouTube URL>` and `/ytmp4 <YouTube URL>` remain available for authorized content.
- Other bot moderation, Gemini, Cloudflare image, memory, reaction, and settings features remain in `index.js`.

Use media downloads only for content you own or have permission/licensing to use. YouTube API search returns metadata and thumbnails; the separate `yt-dlp`/`ffmpeg` binaries handle authorized media processing. Files are capped below Telegram's bot upload limit.

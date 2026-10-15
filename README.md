# Saaya Telegram Bot — Pro Features Update

The bot source is `index.js`. This update preserves the established persona text and numeric Telegram owner-ID matching. It adds the requested owner-mention restraint, reaction modes, memory tools, digests, group-specific wish settings, configurable warning escalation, FAQ drafts, and voice transcription. YouTube and Google TTS remain removed.

## Railway variables

Required:

- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY`
- `BOT_OWNER_ID` — the owner's numeric Telegram user ID

For image generation, set both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Optional settings include `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite`), `GEMINI_TRANSCRIBE_MODEL` (defaults to `gemini-3.5-transcribe`), `OWNER_HANDLE`, `OWNER_CHAT_ID`, `BOT_NAME`, `GROUP_TRIGGER`, and `DATA_FILE`. Keep API keys in Railway Variables; do not commit secrets to GitHub.

## New commands

### Reactions

- `/reactionmode fast` — quick local emoji, no Gemini refinement.
- `/reactionmode smart` — quick local emoji followed by background Gemini refinement.
- `/reactionmode off` — disable reactions for the current DM; group admins can set a group mode.
- `/autoreact on|off` remains available in groups and maps to `smart|off`.

The first reaction in a chat may need a Telegram request to discover allowed reactions. Telegram permissions and the chat's available reactions still apply. Smart mode can make an additional Gemini request per eligible message; use `fast` to avoid that extra call.

### Memory search and removal

- `/memorysearch <keyword>` searches the last 10 days of the current DM or group memory and returns recent matches.
- `/forget <keyword>` removes matching saved conversation turn(s), including the paired reply where available.
- Group memory search and deletion are admin-only. Existing `/memory`, `/resetmemory`, `/groupmemory`, and `/resetgroupmemory` controls remain.

### Digests

- `/digest today` summarizes memory from the current day in India Standard Time.
- `/digest week` summarizes the previous seven days.

In groups, only an admin can request a digest. The digest is generated from messages the bot has actually received and retained. Group digests are unavailable while `/groupmemory` is off.

### Group-specific scheduled wishes

- `/wishsettings times 07:00,13:00,18:00,22:30` sets four unique 24-hour IST times, in morning/afternoon/evening/night order.
- `/wishsettings language Hindi` sets the language used for that group's shayari.
- `/wishsettings reset` returns to the default schedule and language.
- `/wishsettings` with no arguments shows the current settings. Group admins only.
- `/wish on|off` opts the current chat in or out. In groups, an admin controls the group.

The bot creates a fresh text wish for each due schedule/language and shares it with the chats due at that time. In a running process, one generated scenic image is reused for all groups for the same date and time-of-day slot, even if their chosen clock times differ. With the default schedule this is up to four scheduled image generations per day. Custom times/languages may cause additional Gemini text requests. An image-generation failure falls back to text.

### Warning escalation

- `/warnlimit 3 ban` — after three warnings, ban the user (default behavior).
- `/warnlimit 3 mute 30` — after three warnings, mute the user for 30 minutes.
- `/warnlimit off` disables automatic escalation; `/warnings` shows the current count.

Only group admins can set thresholds/actions or issue warnings. Telegram admin permissions are required for the selected ban/mute action.

### FAQ drafts

- `/faq suggest` uses recent group memory to propose up to five **drafts**. It does not save them automatically.
- Admins can review a draft and add an approved item with `/faq add <question> | <answer>`.

Only group admins can request suggestions or modify the FAQ. Suggestions can be incomplete or wrong, so review each answer before saving it.

### Voice transcription

- Reply to a voice/audio message with `/transcribe` to receive its transcript.
- In DMs, voice notes are transcribed and answered automatically. In groups, the user must already have activated Saaya or include the trigger in the voice-note caption.
- Telegram voice files larger than 14 MB are rejected. Transcription uses the existing `GEMINI_API_KEY`; no separate voice key is required. The bot uploads audio through Gemini Files API, passes the file URI to the transcription model, and attempts to delete the temporary file immediately after use. If cleanup fails, Google automatically deletes files after 48 hours.
- A voice note that gets a conversational reply uses two Gemini calls: one for transcription and one for the reply. Both count against that user's daily AI request limit. A `/transcribe` command uses one.

## Memory, privacy, and durable storage

- DM and group memory retain text/captions for up to 10 days. `/forget` can remove matching turns; `/resetmemory` and `/resetgroupmemory` clear all saved memory in the relevant context.
- Group memory only contains messages Telegram delivers to the bot. To receive ordinary group messages, disable the bot's Privacy Mode with BotFather `/setprivacy`; Telegram may require removing and re-adding the bot after the change.
- Memory, recipient preferences, reminders, warning settings, and wish configuration are stored in the state file. For persistence across Railway redeploys/restarts, attach a Volume at `/data` and set `DATA_FILE=/data/saaya-state.json`.
- Run **one active Railway replica per bot token** to avoid duplicate scheduled broadcasts.
- A private user must first open the bot and send it a message before Telegram allows the bot to DM them.

## Other existing features

`/help` lists the complete command set. Existing moderation, anti-link, flood protection, welcome messages, reports, verification, group rules/FAQ, reminders, image generation, diagnostics, and numeric owner-ID checks remain in place. The owner is mentioned only when directly relevant or asked; the rest of the established persona wording is retained.

## API references

- Gemini 3.5 Transcribe model: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe
- Gemini audio transcription: https://ai.google.dev/gemini-api/docs/transcribe
- Gemini resumable Files API upload and cleanup: https://ai.google.dev/gemini-api/docs/files
- Gemini supported audio MIME types: https://ai.google.dev/gemini-api/docs/audio
- Telegram Bot API file-download limit: https://core.telegram.org/bots/faq

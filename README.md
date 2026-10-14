# Saaya Telegram Bot

The bot source is `index.js`. It retains the existing Gemini model, Cloudflare image generation, persona/style rules, numeric Telegram owner recognition, moderation, memory, and reaction behavior. YouTube and Google TTS integrations remain removed.

## Railway variables

Required: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, and the owner's exact numeric Telegram user ID in `BOT_OWNER_ID`.

For image generation, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Optional settings include `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite`), `OWNER_HANDLE`, `OWNER_CHAT_ID`, `BOT_NAME`, `GROUP_TRIGGER`, and `DATA_FILE`. Keep API keys in Railway Variables; do not commit secrets to GitHub.

For reliable reminders and saved configuration across redeploys, attach a Railway Volume mounted at `/data` and set `DATA_FILE=/data/saaya-state.json`. Reminders are one-time and the bot must be running when they are due. Run one active replica per bot token.

For private owner alerts and reports, the owner must open the bot DM and send `/start` at least once. Set `OWNER_CHAT_ID` to the owner's private Telegram chat ID if it differs from `BOT_OWNER_ID`.

## New group/admin features

- `/setrules <text>` and `/setrules clear` — group admins set or clear per-group AI guidance; it supplements rather than replaces Saaya's persona.
- `/rules` — view the current group's rules.
- `/faq add <question> | <answer>`, `/faq list`, `/faq delete <id>` — maintain a small group-specific FAQ. Relevant FAQ entries are supplied to Gemini as group context.
- `/report` — reply to a message and send `/report [reason]`; the excerpt and metadata are saved and sent privately to the owner. The owner can use `/reports` and `/resolve <id>` in a private DM.
- `/verification on|off` — optional, **off by default**. Saaya must be a group admin with **Restrict Members** permission. New members must tap Verify within two minutes or are removed.
- `/remind HH:MM <text>` — schedule the next occurrence of the 24-hour clock time in Asia/Kolkata. `/reminders` lists pending items and `/cancelreminder <id>` cancels one. Group admins can manage their chat's reminders; in a private chat, only the configured owner can.
- `/diagnose` — admin-only checks for group permissions, configuration, and storage; it does not display secrets.

The `/help` response is formatted with bold section labels while keeping command names copyable. AI responses use context-matched emojis; static text replies receive a fitting emoji when needed.

## Other commands

`/myid`, `/health`, `/settings`, `/style`, `/joke`, `/summarize`, `/language`, `/memory`, `/resetmemory`, `/image`, moderation commands (`/ban`, `/unban`, `/kick`, `/warn`, `/warnings`, `/clear`, `/lock`, `/unlock`), and group controls (`/welcome`, `/autoreact`, `/antilink`, `/archive`, `/flood`, `/trigger`, `/mute`, `/unmute`, `/limits`, `/allow`, `/block`, `/unblock`, `/stats`) remain available. Use `/help` in Telegram for syntax.

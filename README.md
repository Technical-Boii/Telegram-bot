# Saaya Telegram Bot

Railway-ready Telegram group and inbox bot. It uses Telegram's official Bot API through Telegraf, Gemini for chat replies, and ElevenLabs for `/say` voice notes. Settings, quotas, allow/block lists and optional private-chat memory are stored in a local JSON file. No Instagram session ID or account cookie is used.

## Behaviour

- In private chat, answers incoming text messages.
- In groups/supergroups, stays quiet unless a message contains “Saaya” (configurable with `GROUP_TRIGGER`), mentions the bot, or replies to a bot message. It replies to the triggering message.
- `/say <text>` converts the supplied text into a Telegram voice note. Example: `/say Kaise ho?`
- `/ask <question>`, `/translate <language> <text>`, `/summarize`, `/joke`, and `/quote` use Gemini. `/health` reports basic configuration/uptime. `/start`, `/help`, `/about`, and `/myid` are also supported.
- The persona is multilingual, witty and friendly. If directly asked whether it is AI, it says so honestly. It mentions `OWNER_HANDLE` only if asked who made it.
- Insults get a mild playful comeback or a boundary, not extreme slurs/abuse.
- `/language <name>` and `/style <friendly|balanced|savage>` set personal preferences. In groups, admins can set defaults.
- `/replymode text|voice` selects text or TTS for AI replies. Voice mode needs ElevenLabs and obeys TTS quotas; when TTS is unavailable, the bot falls back to text.
- DM memory is enabled by default, stores the last few turns per user in the configured JSON file, and is not enabled for groups. Use `/memory off` to disable and erase it, `/memory on` to re-enable, or `/resetmemory` to clear it.
- Group admins can use `/settings`, `/trigger <word>`, `/setvoice <voice_id>`, `/mute`, `/unmute`, `/limits <cooldown_sec> <AI/user/day> <voice/user/day> <voice/group/day>`, `/allow`, `/block`, `/unblock`, and `/stats`.
- Group allowlist is off by default. Once at least one user is allowlisted, only IDs on that list can use the bot in that group. Blocked users are denied. Usage limits and cooldowns are enforced per chat/user.

## Set up TTS

1. Create an API key in your ElevenLabs account at https://elevenlabs.io/app/settings/api-keys.
2. Pick a feminine voice that sounds good speaking Hindi/Hinglish. Copy its **Voice ID** from the voice page/library. The chosen voice determines whether the sound is feminine and which accent it has; the API model cannot guarantee a particular gender/identity from the text alone.
3. Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in Railway Variables. `ELEVENLABS_MODEL_ID` defaults to `eleven_flash_v2_5`, optimized for low latency and multilingual output. For a richer, more expressive voice, try `eleven_multilingual_v2`; it may take longer. Hindi is supported by both multilingual models.
4. Use `/say Kaise ho?` in Telegram. The bot sends it as a voice note. TTS usage may consume account quota/credits; check the provider's current pricing and limits. Do not expose API keys.

The project requests Opus 48 kHz audio for Telegram voice notes and caps each `/say` request at 600 characters to manage latency and usage.

## Create the Telegram bot

1. Open Telegram and message the verified `@BotFather` account.
2. Send `/newbot`, follow its prompts, and copy the bot token. Treat it like a password.
3. In BotFather, use `/setprivacy`, select this bot, then choose **Disable** so it can see normal group messages and detect “Saaya”. Add the bot to your group; admin rights are not required just to reply.
4. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) for text replies. Keep the key private and add it only as a Railway variable.
5. The default text model is `gemini-3.5-flash-lite`, a fast, cost-efficient model. Change it using `GEMINI_MODEL` if you want another Gemini API model available to your key.

## Deploy to Railway

1. Push this project to a private GitHub repository.
2. In Railway, create a project and create a service from that repository.
3. In Railway **Variables**, set `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `BOT_OWNER_ID`, and `DATA_FILE=/data/saaya-state.json`. Also set optional variables from `.env.example` if needed.
4. Add a Railway **Volume** mounted at `/data`. This keeps the JSON state (group settings, usage counters and DM memory) across deploys. Without the volume, this data is ephemeral and may disappear after redeploy/restart.
5. Railway detects Node from `package.json`; start command is `npm start`. Deploy and check logs for “is running with Gemini.”
6. Keep exactly one running replica/service using this Telegram token: Telegram long polling does not work reliably when multiple copies poll the same bot.

## Full setup, step by step

1. Download the ZIP, extract it, and upload the files to a **private** GitHub repository. Keep `.env` and API keys out of GitHub.
2. In Telegram, open `@BotFather`, send `/newbot`, and save the token. Then send `/setprivacy`, select Saaya, and choose **Disable** so the bot can see the “Saaya” trigger in ordinary group messages.
3. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Set it as Railway variable `GEMINI_API_KEY`. Default model is `gemini-3.5-flash-lite`; change `GEMINI_MODEL` only to a model available to your key.
4. Create the ElevenLabs API key and select a Hindi-capable feminine voice. Put the key in `ELEVENLABS_API_KEY` and its voice ID in `ELEVENLABS_VOICE_ID`.
5. In Railway, create a project and deploy a service from the GitHub repository. Set the start command to `npm start` if Railway does not detect it automatically.
6. In service Variables, configure `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`. Set `DATA_FILE=/data/saaya-state.json`. Add a persistent Volume mounted at `/data`.
7. Deploy and message the bot privately with `/myid`. Copy the numeric ID into Railway variable `BOT_OWNER_ID`, then redeploy. This enables owner-only controls in private chat.
8. Add Saaya to the Telegram group. To let it see ordinary text for wake-word detection, keep privacy disabled. For reliable admin-only command verification, promote the bot to group administrator with **no extra permissions**; never grant moderation permissions it does not need. If Telegram cannot verify the sender, admin commands fail closed.
9. Test `/settings`, `/trigger Saaya`, `/limits 3 30 20 100`, `/ask hello`, `/joke`, `/quote`, `/translate Hindi Good morning`, reply to a text with `/summarize`, then try `/say Kaise ho?` and `/replymode voice`.

### Commands

Admin commands are group-admin-only (or owner-ID-only in private chat where applicable): `/settings`, `/trigger <word>`, `/setvoice <voice_id>`, `/mute`, `/unmute`, `/limits <cooldown> <AI/user/day> <voice/user/day> <voice/group/day>`, `/allow`, `/block`, `/unblock`, `/stats`.

User commands: `/ask <question>`, `/translate <language> <text>`, `/summarize` (reply to text), `/joke`, `/quote`, `/health`, `/say <text>`, `/replymode <text|voice>`, `/language <name|auto>`, `/style <friendly|balanced|savage>`, `/voice <voice_id|reset>` (private chat only), `/memory <on|off>` and `/resetmemory` (private chat only). For `/allow`, `/block`, and `/unblock`, reply to the target user's message with the command or pass their numeric Telegram user ID.

Railway's persistent service is intended to stay running, but actual uptime depends on service state and Telegram/Gemini/ElevenLabs availability. No one-second reply guarantee is possible. Store keys only in Railway Variables or a private local `.env`; never commit or share them. DM conversation history is personal data: `/memory off` erases the sender's stored DM context, and `/resetmemory` clears it on request. The admin can erase the JSON file by stopping the service and deleting the volume contents. If a key leaks, revoke it and replace the Railway variable.

## Included pro features

Group wake-word settings, mute controls, admin settings, voice selection, per-chat/user cooldowns and daily quotas, allow/block lists, usage/error stats, multilingual translation, summaries, jokes, original quotes, voice/text reply preferences, and opt-out private DM memory are implemented. Group chat is opt-in through the trigger word, bot mention, or replying to Saaya.

## Local run

```sh
cp .env.example .env
# Put your real values in .env; keep it private and never commit it.
npm install
npm start
```

The bot uses Telegram long polling and does not need a public webhook URL/domain.

## Official API references

- [Gemini Interactions API overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Gemini Interactions API reference](https://ai.google.dev/api/interactions-api)
- [Gemini model catalogue](https://ai.google.dev/gemini-api/docs/models)
- [Create a Gemini API key](https://aistudio.google.com/apikey)
- [Telegram Bot API](https://core.telegram.org/bots/api)

# Saaya Telegram Bot — Railway par deploy guide

## 1. ZIP aur GitHub taiyar karein

1. `saaya-telegram-bot.zip` download karke unzip karein.
2. Saari files ek **private GitHub repository** mein upload karein. `.env` ya asli API keys GitHub par upload na karein.

## 2. Telegram bot banayein

1. Telegram mein verified `@BotFather` ko kholen aur `/newbot` bhejein.
2. Bot ka naam aur username chun kar BotFather se mila `TELEGRAM_BOT_TOKEN` private rakhein.
3. BotFather mein `/setprivacy` bhejein, apna bot select karein, phir **Disable** karein. Isse group messages mein “Saaya” trigger detect ho sakega.

## 3. Gemini aur voice API keys

1. [Google AI Studio API keys](https://aistudio.google.com/apikey) se Gemini key banayein. Railway variable ka naam `GEMINI_API_KEY` hoga.
2. `/say` voice notes chahiye to [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) banayein. Hindi/Hinglish bolne wali feminine voice chun kar uska Voice ID copy karein.
3. API keys ko sirf Railway Variables mein set karein. Kisi chat ya GitHub repository mein share/commit na karein.

## 4. Railway service banayein

1. Railway kholen, **New Project → Deploy from GitHub Repo** chunein aur private bot repository select karein.
2. Service ka start command `npm start` rakhein. `package.json` se Railway aksar ise khud pehchan leta hai.
3. Service mein **Variables** tab khol kar ye variables add karein:

```text
TELEGRAM_BOT_TOKEN=BotFather se mila token
GEMINI_API_KEY=Google AI Studio se mili key
GEMINI_MODEL=gemini-3.5-flash-lite
ELEVENLABS_API_KEY=ElevenLabs key
ELEVENLABS_VOICE_ID=chuni hui voice ka ID
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
BOT_OWNER_ID=abhi ke liye khaali chhodein; /myid se ID milne ke baad bharein
OWNER_HANDLE=@alone.shayar.420
BOT_NAME=Saaya...🧿🤍🍂
GROUP_TRIGGER=saaya
DATA_FILE=/data/saaya-state.json
```

Agar voice feature nahi chahiye to `ELEVENLABS_API_KEY` aur `ELEVENLABS_VOICE_ID` ki zaroorat nahi. Gemini replies ke liye `GEMINI_API_KEY` zaroori hai.

## 5. Settings aur memory bachane ke liye Volume

Railway service ke **Settings → Volumes → Add Volume** mein volume banayein aur mount path `/data` set karein. `DATA_FILE=/data/saaya-state.json` variable bhi rakhein. Is file mein group settings, daily usage counts aur DM memory hoti hai. Volume na lagaya to redeploy/restart ke baad saved settings mit sakti hain.

## 6. Deploy aur owner ID set karein

1. Railway se deploy karein. Logs mein `is running with Gemini` aana chahiye.
2. Telegram par bot ko private message karke `/myid` bhejein.
3. Bot jo numeric ID de, use Railway variable `BOT_OWNER_ID` mein set karein aur redeploy karein. Isse aapko private chat mein owner/admin commands milenge.
4. Bot ko group mein add karein. Group ke regular messages dekhne ke liye privacy disabled rehni chahiye.
5. Admin-only commands ko group admins se verify karne ke liye bot ko group administrator banayein, par use **koi extra moderation permission na dein**. Agar admin role verify nahi ho paata, commands safety ke liye mana karenge.
6. Ek Telegram bot token ke saath Railway par ek hi running replica rakhein—polling ke liye duplicate workers na chalayen.

## 7. Commands ka test

- `/settings` — group/chat settings
- `/trigger Saaya` — admin group wake word badle
- `/mute` ya `/unmute` — group replies band/chalu
- `/limits 3 30 20 100` — cooldown seconds, AI requests per user/day, voice notes per user/day, voice notes per group/day
- `/allow` ya `/block` — target user ke message par reply karke bhejein; ya `/allow 123456789` jaise numeric ID dein
- `/unblock` — user ko list se hataayein
- `/stats` — aaj ke group usage aur errors
- `/ask sawaal` — Gemini se jawab
- `/joke`, `/quote`, `/health` — joke, original quote, aur status
- `/translate Hindi Good morning` — text translation
- Kisi text message par reply karke `/summarize` — summary
- `/say Kaise ho?` — voice note (ElevenLabs variables required)
- `/replymode voice` — AI responses ko voice note mein bhejo; `/replymode text` se wapas text. Voice quota lagti hai.
- `/language Hindi` aur `/style friendly|balanced|savage` — personal preference; group admins defaults badal sakte hain
- Private DM mein `/voice <Voice ID>` — personal TTS voice; `/voice reset` se default
- Private DM mein `/memory off` — saved context mita kar memory band; `/memory on` se dobara chalu; `/resetmemory` se history clear

DM conversation memory private chat ke recent turns ko Railway Volume ki JSON file mein save karti hai. Group chats ki memory save nahi hoti. User memory off/clear kar sakta hai. Railway volume ke andar file admin manually bhi delete kar sakta hai.

**Dhyan rahe:** Railway, Telegram, Gemini, ya ElevenLabs ki uptime/latency bot ke control mein nahi. Har reply ek second ke andar aane ki guarantee nahi hoti. Gemini/ElevenLabs ki quota aur billing provider ke account ke hisaab se lagu hoti hai.

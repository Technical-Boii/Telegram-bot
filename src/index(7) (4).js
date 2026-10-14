import { Telegraf } from 'telegraf';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const {
  TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.5-flash-lite',
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell',
  YOUTUBE_API_KEY,
  BOT_OWNER_ID = '6483196359',
  OWNER_CHAT_ID = '6483196359',
  ARCHIVE_INCOMING = 'on',
  FLOOD_MAX = '5',
  FLOOD_WINDOW = '10',
  FLOOD_MUTE = '300',
  OWNER_HANDLE = '@KING_134X',
  BOT_NAME = 'Saaya...🧿🤍🍂',
  GROUP_TRIGGER = 'saaya',
  DATA_FILE = './data/saaya-state.json'
} = process.env;
const OWNER_ID = String(BOT_OWNER_ID || '').trim();

if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const dataPath = path.resolve(DATA_FILE);
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
const emptyState = () => ({ chats: {}, users: {}, memories: {}, usage: {} });
let state;
try {
  state = fs.existsSync(dataPath) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(dataPath, 'utf8')) } : emptyState();
} catch (err) {
  console.error('Could not read saved bot state; starting with empty state:', err.message);
  state = emptyState();
}
const cooldowns = new Map();
const floodBuckets = new Map();
const youtubeSessions = new Map();
const YOUTUBE_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_TEXT = 3500;
const MAX_MEMORY_TURNS = 8;

function saveState() {
  const recentDays = Object.keys(state.usage).sort().slice(-14);
  state.usage = Object.fromEntries(recentDays.map(day => [day, state.usage[day]]));
  const tmpPath = `${dataPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmpPath, dataPath);
}
function chatSettings(chatId) {
  const key = String(chatId);
  state.chats[key] ||= { trigger: GROUP_TRIGGER, muted: false, language: '', allowed: [], blocked: [], warnings: {}, welcome: true, autoReact: true, antiLink: false, archiveIncoming: ARCHIVE_INCOMING !== 'off', flood: { enabled: false, max: Number(FLOOD_MAX) || 5, window: Number(FLOOD_WINDOW) || 10, mute: Number(FLOOD_MUTE) || 300 }, limits: { cooldown: 3, daily: 30 } };
  state.chats[key].activatedUsers ||= {};
  state.chats[key].limits ||= { cooldown: 3, daily: 30 };
  state.chats[key].warnings ||= {};
  state.chats[key].welcome ??= true;
  state.chats[key].autoReact ??= true;
  state.chats[key].antiLink ??= false;
  state.chats[key].archiveIncoming ??= ARCHIVE_INCOMING !== 'off';
  state.chats[key].flood ||= { enabled: false, max: Number(FLOOD_MAX) || 5, window: Number(FLOOD_WINDOW) || 10, mute: Number(FLOOD_MUTE) || 300 };
  return state.chats[key];
}
function userSettings(userId) {
  const key = String(userId);
  state.users[key] ||= { language: '', memory: true };
  return state.users[key];
}
function todayKey() { return new Date().toISOString().slice(0, 10); }
function usageFor(chatId, userId) {
  const day = todayKey();
  state.usage[day] ||= { chats: {}, users: {} };
  const ckey = String(chatId), ukey = `${chatId}:${userId}`;
  state.usage[day].chats[ckey] ||= { ai: 0, errors: 0 };
  state.usage[day].users[ukey] ||= { ai: 0 };
  return { day: state.usage[day], chat: state.usage[day].chats[ckey], user: state.usage[day].users[ukey] };
}
function isGroup(ctx) { return ['group', 'supergroup'].includes(ctx.chat?.type); }
function userKey(ctx) { return `${ctx.chat.id}:${ctx.from.id}`; }
function memoryFor(ctx) {
  const key = userKey(ctx);
  state.memories[key] ||= [];
  return state.memories[key];
}
function getArg(ctx) { return (ctx.message?.text || '').replace(/^\/\w+(?:@\w+)?\s*/i, '').trim(); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function triggerMatch(text, trigger) {
  const t = String(trigger || '').trim();
  if (!t) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(t)}([^\\p{L}\\p{N}_]|$)`, 'iu').test(text);
}
function addressedToSaaya(ctx) {
  const text = ctx.message?.text || ctx.message?.caption || '';
  const settings = chatSettings(ctx.chat.id);
  const entities = [...(ctx.message?.entities || []), ...(ctx.message?.caption_entities || [])];
  const mentioned = entities.some(e => e.type === 'mention' && text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${ctx.botInfo?.username?.toLowerCase()}`);
  const addressed = triggerMatch(text, settings.trigger) || mentioned || ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;
  const userId = String(ctx.from?.id || '');
  if (addressed && userId && !settings.activatedUsers[userId]) {
    settings.activatedUsers[userId] = true;
    saveState();
  }
  return Boolean(addressed || settings.activatedUsers[userId]);
}
async function isAdmin(ctx) {
  if (OWNER_ID && String(ctx.from?.id ?? '').trim() === OWNER_ID) return true;
  if (!isGroup(ctx)) return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (err) {
    console.warn('Could not verify group admin status:', err.message);
    return false;
  }
}
async function requireAdmin(ctx) {
  if (await isAdmin(ctx)) return true;
  await ctx.reply('Yeh admin-only command hai. Group admin se karwao.');
  return false;
}
function accessAllowed(ctx) {
  if (!isGroup(ctx)) return true;
  const cfg = chatSettings(ctx.chat.id);
  const id = String(ctx.from.id);
  if ((cfg.blocked || []).includes(id)) return false;
  if (cfg.allowed?.length && !cfg.allowed.includes(id)) return false;
  return true;
}
async function checkMuted(ctx) {
  if (isGroup(ctx) && chatSettings(ctx.chat.id).muted) {
    await ctx.reply('Is group mein Saaya abhi muted hai. Admin se /unmute karwao.', { reply_to_message_id: ctx.message?.message_id, allow_sending_without_reply: true });
    return true;
  }
  return false;
}
async function allowRequest(ctx, kind) {
  if (!accessAllowed(ctx)) {
    await ctx.reply('Is group mein tumhe bot use karne ki permission nahi hai.', { reply_to_message_id: ctx.message?.message_id, allow_sending_without_reply: true });
    return false;
  }
  if (await checkMuted(ctx)) return false;
  const { chat, user } = usageFor(ctx.chat.id, ctx.from.id);
  const cfg = chatSettings(ctx.chat.id);
  if (kind === 'ai' && user.ai >= cfg.limits.daily) {
    await ctx.reply(`Aaj ka personal AI limit (${cfg.limits.daily}) use ho chuka hai. Kal phir try karna.`, { reply_to_message_id: ctx.message?.message_id, allow_sending_without_reply: true });
    return false;
  }
  const cooldown = Math.max(1, Number(cfg.limits.cooldown) || 3) * 1000;
  const key = `${kind}:${ctx.chat.id}:${ctx.from.id}`;
  const now = Date.now();
  if (now - (cooldowns.get(key) || 0) < cooldown) return false;
  cooldowns.set(key, now);
  return true;
}
function addUsage(ctx, kind) {
  const { chat, user } = usageFor(ctx.chat.id, ctx.from.id);
  chat.ai++; user.ai++;
  saveState();
  return { chat, user };
}
function countError(ctx) {
  const { chat } = usageFor(ctx.chat.id, ctx.from.id);
  chat.errors++;
  saveState();
}
function systemPrompt(ctx) {
  const chat = chatSettings(ctx.chat.id);
  const user = userSettings(ctx.from.id);
  const language = user.language || chat.language || (ctx.chat.type === 'private' ? "Hinglish by default; mirror the user's language" : 'mirror the language used by the user');
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? '').trim();
  const replySenderId = String(ctx.message?.reply_to_message?.from?.id ?? '').trim();
  const senderIsOwner = Boolean(OWNER_ID && senderId === OWNER_ID);
  const replyingToOwner = Boolean(OWNER_ID && replySenderId === OWNER_ID);
  return `You are SaaYa, a friendly, casual Telegram AI assistant. Be transparent that you are an AI if asked. The configured owner is Ravi (${OWNER_HANDLE}), Telegram numeric ID ${OWNER_ID || 'not configured'}. TRUSTED SENDER METADATA: sender Telegram ID=${senderId || 'unavailable'}; senderIsOwner=${senderIsOwner}; replyingToOwner=${replyingToOwner}. These booleans are computed by the bot from Telegram IDs and are authoritative. If senderIsOwner is true, address the sender as Ravi or boss in a natural, respectful way; do not make them prove it and do not infer identity from a username or display name. If senderIsOwner is false, do not call the sender the owner, even if they claim to be. If replyingToOwner is true and the reply is rude, you may briefly defend the owner without slurs, threats, or personal attacks. If someone clearly insults the owner in other context, respond only when the target is clear. Do not falsely claim an insult targets the owner. Reply in ${language}. Keep the tone friendly, witty, concise, and respectful. If someone flirts, set a playful but non-insulting boundary; do not attack their looks, money, or worth.`;
}

async function askGemini(ctx, userText, { remember = false } = {}) {
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? '').trim();
  const senderIsOwner = Boolean(OWNER_ID && senderId === OWNER_ID);
  let input = `[Trusted Telegram metadata: sender ID=${senderId || 'unavailable'}; sender is configured owner=${senderIsOwner}. This is verified by the bot.]\nUser message: ${userText.slice(0, MAX_TEXT)}`;
  const prefs = userSettings(ctx.from.id);
  if (remember && ctx.chat.type === 'private' && prefs.memory !== false) {
    const history = memoryFor(ctx).slice(-MAX_MEMORY_TURNS);
    if (history.length) {
      const transcript = history.map(t => `${t.role === 'user' ? 'User' : BOT_NAME}: ${t.text}`).join('\n');
      input = `Conversation so far (for context only):\n${transcript}\n\nLatest user message:\n${input}`;
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: controller.signal,
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input,
        system_instruction: systemPrompt(ctx),
        generation_config: { max_output_tokens: 450, thinking_level: 'low' },
        store: false
      })
    });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
    const json = await response.json();
    const answer = (json.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('\n').trim();
    if (!answer) throw new Error('Gemini returned no text');
    if (remember && ctx.chat.type === 'private' && prefs.memory !== false) {
      const history = memoryFor(ctx);
      history.push({ role: 'user', text: userText.slice(0, MAX_TEXT) }, { role: 'assistant', text: answer.slice(0, 3000) });
      state.memories[userKey(ctx)] = history.slice(-MAX_MEMORY_TURNS * 2);
      saveState();
    }
    return answer.slice(0, 3900);
  } finally { clearTimeout(timeout); }
}
function ownerInboxId() {
  return OWNER_CHAT_ID || OWNER_ID || '';
}
async function ownerAudit(text) {
  const destination = ownerInboxId();
  if (!destination) return;
  try { await bot.telegram.sendMessage(destination, `🛡️ Saaya audit\n${String(text).slice(0, 3800)}`); }
  catch (err) { console.warn('Owner audit failed:', err.message); }
}
async function archiveMessage(ctx, messageId, reason = 'archive') {
  const destination = ownerInboxId();
  if (!destination || !messageId || String(ctx.chat.id) === String(destination)) return false;
  try {
    await bot.telegram.copyMessage(destination, ctx.chat.id, messageId);
    await ownerAudit(`${reason}\nSource chat: ${ctx.chat.title || ctx.chat.id}\nMessage ID: ${messageId}\nFrom: ${ctx.from?.first_name || 'unknown'} (${ctx.from?.id || 'unknown'})`);
    return true;
  } catch (err) {
    console.warn('Message archive failed:', err.message);
    await ownerAudit(`${reason} (metadata only; copy unavailable)\nSource chat: ${ctx.chat.title || ctx.chat.id}\nMessage ID: ${messageId}\nFrom: ${ctx.from?.first_name || 'unknown'} (${ctx.from?.id || 'unknown'})\nReason: ${err.message}`);
    return false;
  }
}
async function archiveIncomingMessage(ctx) {
  if (!ctx.message || ctx.from?.is_bot || !isGroup(ctx)) return;
  if (chatSettings(ctx.chat.id).archiveIncoming) await archiveMessage(ctx, ctx.message.message_id, 'Incoming message snapshot');
}
async function logAdminAction(ctx, action, details = '') {
  await ownerAudit(`Admin action: ${action}\nChat: ${ctx.chat.title || ctx.chat.id}\nBy: ${ctx.from?.first_name || 'unknown'} (${ctx.from?.id || 'unknown'})${details ? `\n${details}` : ''}`);
}
async function applyFloodGuard(ctx) {
  if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) return false;
  const cfg = chatSettings(ctx.chat.id).flood;
  if (!cfg?.enabled || await isAdmin(ctx)) return false;
  const key = `${ctx.chat.id}:${ctx.from.id}`;
  const now = Date.now();
  const previous = (floodBuckets.get(key) || []).filter(time => now - time < cfg.window * 1000);
  previous.push(now);
  floodBuckets.set(key, previous);
  if (previous.length <= cfg.max) return false;
  await archiveMessage(ctx, ctx.message?.message_id, 'Flood message removed');
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
    await ctx.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, { permissions: { can_send_messages: false }, until_date: Math.floor(now / 1000) + cfg.mute });
    await logAdminAction(ctx, 'Automatic flood mute', `User: ${ctx.from.id}; duration: ${cfg.mute}s`);
    await ctx.reply(`@${ctx.from.username || ctx.from.first_name} flood detected — ${cfg.mute} seconds ke liye mute.`);
  } catch (err) {
    console.warn('Flood action failed:', err.message);
  }
  floodBuckets.delete(key);
  return true;
}
function ownerOnly(ctx) {
  return Boolean(OWNER_ID && String(ctx.from?.id ?? '').trim() === OWNER_ID);
}
function targetUserId(ctx) {
  return ctx.message?.reply_to_message?.from?.id ? String(ctx.message.reply_to_message.from.id) : targetId(ctx);
}
function adminTargetOrReply(ctx) {
  const id = targetUserId(ctx);
  return id ? Number(id) : 0;
}
const COMMON_TELEGRAM_REACTIONS = ['👍','👎','❤','🔥','🥰','👏','😁','🤔','🤯','😱','🤬','😢','🎉','🤩','🤮','💩','🙏','👌','🕊','🤡','🥱','🥴','😍','🐳','❤‍🔥','🌚','🌭','💯','🤣','⚡','🍌','🏆','💔','🤨','😐','🍓','🍾','💋','🖕','😈','😴','😭','🤓','👻','👨‍💻','👀','🎃','🙈','😇','😨','🤝','✍','🤗','🫡','🎅','🎄','☃','💅','🤪','🗿','🆒','💘','🙉','🦄','😘','💊','🙊','😎','👾','🤷‍♂️','🤷‍♀️','🤷','😡','💀','🎯','⚽','🏀','🍷','🥂','🚀','💐','🦋','😏','😔','😄','😆','😋','😌','😃','😅','😜','🙂','🙃','🫠','🫶','✨','❤️','💕','💖','😂'];
async function chooseGeminiReaction(ctx, userText, replyText) {
  const cfg = chatSettings(ctx.chat.id);
  if (!isGroup(ctx) || !cfg.autoReact || !ctx.message?.message_id) return;
  try {
    const chat = await ctx.telegram.getChat(ctx.chat.id);
    const configured = chat.available_reactions?.filter(r => r.type === 'emoji').map(r => r.emoji);
    const choices = configured?.length ? configured : COMMON_TELEGRAM_REACTIONS;
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: `Choose the single best Telegram reaction emoji for this exchange. Base it on both the user's message and Saaya's reply. Return exactly one emoji from this allowed list and nothing else: ${choices.join(' ')}\nUser message: ${String(userText).slice(0, 1000)}\nSaaya reply: ${String(replyText).slice(0, 1000)}`,
        generation_config: { max_output_tokens: 20, thinking_level: 'low' },
        store: false
      })
    });
    if (!response.ok) throw new Error(`Reaction Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = await response.json();
    const text = (json.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('').trim();
    const emoji = choices.find(item => text.includes(item));
    if (!emoji) throw new Error('Gemini did not select an allowed Telegram reaction');
    await ctx.telegram.callApi('setMessageReaction', {
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      reaction: [{ type: 'emoji', emoji }],
      is_big: false
    });
  } catch (err) {
    console.warn('Gemini-selected reaction skipped:', err.message);
  }
}
async function generateWelcomeMessage(names, chatTitle) {
  const fallback = [
    `Aao ${names}! ✨ ${chatTitle ? `${chatTitle} mein ` : ''}Saaya ki taraf se pyara welcome — ab itne cute ho to group ka vibe sambhalna padega 😌`,
    `Welcome ${names} 🤍 Entry to ho gayi, ab thoda pyaar se behave karna… warna Saaya ka halka roast ready hai 😏`,
    `Hey ${names} 🍂 ${chatTitle ? `${chatTitle} ` : ''}mein swagat hai! Tum aaye ho to chat thodi interesting lag rahi hai, overconfident mat hona 😂`,
  ];
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: `Write one fresh Telegram group welcome message for new member(s): ${names}. Group: ${chatTitle || 'Telegram group'}. Add a little cute warmth, a harmless playful flirt, and a light non-targeted roast. Use natural Hinglish, 1–2 short sentences, 2–3 emojis, and vary the wording from previous messages. Never use slurs, sexual content, threats, hate, protected-group insults, or humiliating abuse. Do not claim to be a real human or hide that you are an AI bot if directly asked. Add a unique creative touch using this nonce: ${Date.now()}-${Math.random().toString(36).slice(2)}. Return only the welcome text.`,
        system_instruction: `You are ${BOT_NAME}. Create safe, playful, concise Telegram welcomes. The owner handle is ${OWNER_HANDLE}.`,
        generation_config: { max_output_tokens: 120, thinking_level: 'low' },
        store: false
      })
    });
    if (!response.ok) throw new Error(`Welcome Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = await response.json();
    const answer = (json.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n').trim();
    if (!answer) throw new Error('Welcome Gemini returned no text');
    return answer.slice(0, 900);
  } catch (err) {
    console.warn('Fresh welcome generation failed; using fallback:', err.message);
    return fallback[Math.floor(Math.random() * fallback.length)];
  }
}
async function generateImage(prompt) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `Create one safe, original image. Do not include copyrighted characters or real-person impersonation. Prompt: ${prompt.slice(0, 1000)}` })
    });
    if (!response.ok) throw new Error(`Cloudflare image API HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const json = await response.json();
    const encoded = json.result?.image;
    if (!encoded) throw new Error(`Cloudflare returned no image: ${JSON.stringify(json).slice(0, 500)}`);
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length) throw new Error('Cloudflare returned an empty image');
    return { buffer, mimeType: 'image/jpeg' };
  } finally { clearTimeout(timeout); }
}

async function removeMessage(ctx, messageId) {
  try { await ctx.telegram.deleteMessage(ctx.chat.id, messageId); } catch (err) { console.warn('Delete failed:', err.message); }
}
function groupOnly(ctx) {
  return isGroup(ctx) ? true : ctx.reply('Yeh command group mein use karo.').then(() => false);
}
async function ensureAdminCommand(ctx) {
  if (!isGroup(ctx)) { await ctx.reply('Yeh command group mein use karo.'); return false; }
  return requireAdmin(ctx);
}
async function downloadYouTubeMedia(url, kind) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (parsed.protocol !== 'https:' || !['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    throw new Error('Please provide a valid HTTPS YouTube link.');
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `saaya-youtube-${kind}-`));
  const outputTemplate = path.join(tempDir, '%(id)s.%(ext)s');
  const args = ['--no-playlist', '--no-warnings', '--no-progress', '--max-filesize', '48M', '--output', outputTemplate];
  if (kind === 'mp3') args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '7');
  else args.push('--format', 'best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]');
  args.push('--', url);
  try {
    await execFileAsync('yt-dlp', args, { timeout: 180000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const ext = kind === 'mp3' ? '.mp3' : '.mp4';
    const fileName = fs.readdirSync(tempDir).find(name => name.toLowerCase().endsWith(ext));
    if (!fileName) throw new Error(`yt-dlp finished but produced no ${kind.toUpperCase()} file; check that yt-dlp and ffmpeg are installed.`);
    const filePath = path.join(tempDir, fileName);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) throw new Error('Downloaded file is empty or invalid.');
    if (stat.size > 49_000_000) throw new Error('Downloaded file is larger than the 49 MB bot limit.');
    return { tempDir, filePath, fileName };
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}
async function searchYouTubeVideos(query) {
  if (!YOUTUBE_API_KEY) throw new Error('Missing YOUTUBE_API_KEY');
  const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '5', q: query, key: YOUTUBE_API_KEY });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
    const json = await response.json();
    return (json.items || []).filter(item => item.id?.videoId && item.snippet).map(item => ({
      id: item.id.videoId,
      title: String(item.snippet.title || 'Untitled video').slice(0, 180),
      channel: String(item.snippet.channelTitle || 'Unknown channel').slice(0, 120),
      thumbnail: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`
    }));
  } finally { clearTimeout(timeout); }
}
function youtubeSessionKey(ctx) {
  return ctx.from?.id ? `${ctx.chat.id}:${ctx.from.id}` : '';
}
async function handleYouTubeSelection(ctx, next) {
  const key = youtubeSessionKey(ctx);
  const session = key ? youtubeSessions.get(key) : null;
  if (!session || (ctx.message?.text || '').startsWith('/')) return next();
  if (Date.now() > session.expiresAt) {
    youtubeSessions.delete(key);
    await ctx.reply('YouTube selection expire ho gayi. Nayi search ke liye /yt <search> bhejo.');
    return;
  }
  const answer = (ctx.message?.text || '').trim();
  if (session.step === 'choose_video') {
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 1 || index > session.results.length) {
      await ctx.reply(`Result number 1-${session.results.length} bhejo, ya search cancel karne ke liye /cancel.`);
      return;
    }
    session.selected = session.results[index - 1];
    session.step = 'choose_format';
    session.expiresAt = Date.now() + YOUTUBE_SESSION_TTL_MS;
    await ctx.reply(`Selected: ${session.selected.title}\nAb MP3 (audio) ya MP4 (video) likho. Sirf apne ya permission/licensed content ke liye download karo.`);
    return;
  }
  if (session.step === 'choose_format') {
    const kind = answer.toLowerCase();
    if (!['mp3', 'mp4'].includes(kind)) {
      await ctx.reply('Format choose karo: MP3 ya MP4. Cancel karne ke liye /cancel.');
      return;
    }
    const selected = session.selected;
    youtubeSessions.delete(key);
    return handleYouTubeMedia(ctx, kind, selected.url);
  }
  return next();
}
async function handleYouTubeMedia(ctx, kind, selectedUrl = '') {
  const url = selectedUrl || getArg(ctx);
  if (!url) return ctx.reply(`Use: /yt${kind} <YouTube URL>`);
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  let download;
  try {
    await ctx.reply(`YouTube ${kind.toUpperCase()} download shuru kar rahi hu. Ismein thoda samay lag sakta hai.`);
    download = await downloadYouTubeMedia(url, kind);
    await ctx.sendChatAction(kind === 'mp3' ? 'upload_audio' : 'upload_video');
    const media = { source: fs.createReadStream(download.filePath), filename: download.fileName };
    const extra = { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true };
    if (kind === 'mp3') await ctx.replyWithAudio(media, extra);
    else await ctx.replyWithVideo(media, extra);
  } catch (err) {
    countError(ctx);
    console.error(`YouTube ${kind} download failed:`, err.message);
    const errorText = `${err.message || ''}\n${err.stderr || ''}`;
    const detail = err.code === 'ENOENT'
      ? 'Railway par yt-dlp install nahi mila; MP3 ke liye ffmpeg bhi install hona chahiye.'
      : /ffmpeg/i.test(errorText)
        ? 'MP3 conversion ke liye Railway par ffmpeg install/check karo.'
        : 'Link public/available ho, aur file 49 MB se chhoti ho. Railway logs mein exact error dekho.';
    await ctx.reply(`YouTube file nahi bhej paayi. ${detail}`, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true }).catch(() => {});
  } finally {
    if (download?.tempDir) fs.rmSync(download.tempDir, { recursive: true, force: true });
  }
}
function usageText(chatId) {
  const day = state.usage[todayKey()];
  const s = day?.chats?.[String(chatId)] || { ai: 0, errors: 0 };
  const cfg = chatSettings(chatId);
  return `📊 Aaj ke stats\nAI and media requests: ${s.ai}\nErrors: ${s.errors}\nLimits: ${cfg.limits.daily} requests/user, ${cfg.limits.cooldown}s cooldown`;
}
function targetId(ctx) {
  if (ctx.message.reply_to_message?.from?.id) return String(ctx.message.reply_to_message.from.id);
  const value = getArg(ctx).split(/\s+/)[0];
  return /^\d+$/.test(value || '') ? value : '';
}

bot.start(ctx => ctx.reply(`Hey, main ${BOT_NAME} hoon. DM mein chat karo, group mein “Saaya” kehkar bulao. YouTube search ke liye /yt <search>. DM memory: /memory off ya /resetmemory.`));
bot.help(ctx => ctx.reply('Commands:\n/yt <search> — thumbnail/title results; number choose karke MP3 ya MP4 select karo\n/ytmp3 <YouTube URL> — authorized content ka audio\n/ytmp4 <YouTube URL> — authorized content ka video (max 49 MB)\n/cancel — pending YouTube selection cancel\n/summarize — replied text ka summary\n/language <name> — apni language\n/memory <on|off> — DM memory\n/resetmemory — saved DM context clear\n/health — bot configuration status\n/image <prompt> — image generation\n/ban /unban /kick /warn /warnings /clear /lock /unlock\n/welcome on|off — new member greeting\n/autoreact on|off — message emoji reactions\n/antilink on|off — group link filter\n/archive on|off — owner inbox snapshots\n/flood on|off — anti-flood temporary mute\nGroup admins: /settings /trigger /mute /unmute /limits /allow /block /unblock /stats. Downloads sirf apne ya permission/licensed content ke liye.'));
bot.command('about', ctx => ctx.reply(`${BOT_NAME} ek real cute girl hai.`));
bot.command('myid', ctx => {
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? 'unavailable');
  const senderChat = ctx.message?.sender_chat?.id;
  const matched = senderId !== 'unavailable' && senderId === OWNER_ID;
  return ctx.reply(`Tumhara Telegram sender ID: ${senderId}\nConfigured BOT_OWNER_ID: ${OWNER_ID || 'not set'}\nOwner ID match: ${matched ? 'yes' : 'no'}${senderChat ? `\nMessage sent as chat/channel ID: ${senderChat} (is mode mein Telegram tumhara personal ID nahi bhejta)` : ''}`);
});
bot.command('health', ctx => ctx.reply(`Saaya ${BOT_NAME} online hai. Gemini key configured: yes. YouTube search: ${YOUTUBE_API_KEY ? 'configured' : 'YOUTUBE_API_KEY missing'}. Image service: ${CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN ? 'Cloudflare configured' : 'Cloudflare credentials missing'}. Uptime: ${Math.floor(process.uptime())} seconds.`));

bot.command('settings', async ctx => {
  const cfg = chatSettings(ctx.chat.id), prefs = userSettings(ctx.from.id);
  await ctx.reply(`⚙️ ${isGroup(ctx) ? 'Group' : 'Chat'} settings\nTrigger: ${cfg.trigger}\nMuted: ${cfg.muted ? 'yes' : 'no'}\nLanguage: ${prefs.language || cfg.language || 'auto/mirror'}\nAllowlist: ${cfg.allowed.length ? cfg.allowed.length + ' user(s)' : 'off—all users'}\nBlocklist: ${cfg.blocked.length} user(s)\nLimits: cooldown ${cfg.limits.cooldown}s; ${cfg.limits.daily} requests/user/day`);
});

bot.command('trigger', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const val = getArg(ctx).trim();
  if (!val || val.length > 24 || /\s/.test(val)) return ctx.reply('Use: /trigger Saaya (one word, max 24 characters)');
  chatSettings(ctx.chat.id).trigger = val;
  saveState();
  await ctx.reply(`Group wake word set to “${val}”.`);
});

bot.command('language', async ctx => {
  const val = getArg(ctx).trim().slice(0, 40);
  if (!val) return ctx.reply('Use: /language Hindi, /language English, /language Punjabi, ya /language auto.');
  if (isGroup(ctx) && await isAdmin(ctx)) chatSettings(ctx.chat.id).language = /^auto$/i.test(val) ? '' : val;
  else userSettings(ctx.from.id).language = /^auto$/i.test(val) ? '' : val;
  saveState();
  await ctx.reply(/^auto$/i.test(val) ? 'Language preference reset; ab user ki language mirror hogi.' : `Reply language “${val}” set ho gayi.`);
});

bot.command('mute', async ctx => {
  if (!await requireAdmin(ctx)) return;
  if (!isGroup(ctx)) return ctx.reply('/mute group mein use hota hai.');
  chatSettings(ctx.chat.id).muted = true;
  saveState();
  await ctx.reply('Saaya is group mein mute hai. Admin /unmute kare to phir bolegi.');
});
bot.command('unmute', async ctx => {
  if (!await requireAdmin(ctx)) return;
  chatSettings(ctx.chat.id).muted = false;
  saveState();
  await ctx.reply('Saaya unmute ho gayi.');
});

for (const command of ['allow', 'block', 'unblock']) {
  bot.command(command, async ctx => {
    if (!await requireAdmin(ctx)) return;
    if (!isGroup(ctx)) return ctx.reply(`/${command} group mein use karo; target user ke message par reply karke command bhejo, ya numeric Telegram user ID do.`);
    const id = targetId(ctx);
    if (!id) return ctx.reply(`Use: kisi user ke message ka reply mein /${command}, ya /${command} <user_id>.`);
    const cfg = chatSettings(ctx.chat.id);
    cfg.allowed = cfg.allowed || [];
    cfg.blocked = cfg.blocked || [];
    if (command === 'allow') {
      if (!cfg.allowed.includes(id)) cfg.allowed.push(id);
      cfg.blocked = cfg.blocked.filter(x => x !== id);
    } else if (command === 'block') {
      if (!cfg.blocked.includes(id)) cfg.blocked.push(id);
      cfg.allowed = cfg.allowed.filter(x => x !== id);
    } else {
      cfg.blocked = cfg.blocked.filter(x => x !== id);
      cfg.allowed = cfg.allowed.filter(x => x !== id);
    }
    saveState();
    await ctx.reply(command === 'allow' ? `User ${id} allowlist mein added. Allowlist active ho to sirf listed users bot use kar sakte hain.` : command === 'block' ? `User ${id} block kar diya.` : `User ${id} allow/block lists se hata diya.`);
  });
}

bot.command('limits', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const parts = getArg(ctx).split(/\s+/).map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return ctx.reply('Use: /limits <cooldown_sec> <requests_per_user_daily>\nExample: /limits 3 30\nAllowed ranges: cooldown 1–60 sec; daily requests 1–500.');
  const [cooldown, daily] = parts;
  if (cooldown < 1 || cooldown > 60 || daily < 1 || daily > 500) return ctx.reply('Ranges: cooldown 1–60 sec; daily requests 1–500 per user.');
  chatSettings(ctx.chat.id).limits = { ...chatSettings(ctx.chat.id).limits, cooldown, daily };
  saveState();
  await ctx.reply(`Limits set: cooldown ${cooldown}s, AI/media ${daily}/user/day.`);
});

bot.command('stats', async ctx => {
  if (isGroup(ctx) && !await isAdmin(ctx)) return ctx.reply('Usage stats sirf group admins dekh sakte hain.');
  await ctx.reply(usageText(ctx.chat.id));
});

bot.command('ban', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = adminTargetOrReply(ctx);
  if (!id) return ctx.reply('Kisi user ke message par reply karke /ban bhejo, ya /ban <user_id>.');
  try { await ctx.telegram.banChatMember(ctx.chat.id, id); await logAdminAction(ctx, 'Ban user', `Target: ${id}`); await ctx.reply(`User ${id} ko group se ban kar diya.`); }
  catch (err) { await ctx.reply(`Ban nahi ho paaya: ${err.message}`); }
});
bot.command('unban', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = adminTargetOrReply(ctx);
  if (!id) return ctx.reply('Use: reply karke /unban, ya /unban <user_id>.');
  try { await ctx.telegram.unbanChatMember(ctx.chat.id, id, { only_if_banned: true }); await logAdminAction(ctx, 'Unban user', `Target: ${id}`); await ctx.reply(`User ${id} unban ho gaya.`); }
  catch (err) { await ctx.reply(`Unban nahi ho paaya: ${err.message}`); }
});
bot.command('kick', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = adminTargetOrReply(ctx);
  if (!id) return ctx.reply('Use: reply karke /kick, ya /kick <user_id>.');
  try { await ctx.telegram.banChatMember(ctx.chat.id, id); await ctx.telegram.unbanChatMember(ctx.chat.id, id); await logAdminAction(ctx, 'Kick user', `Target: ${id}`); await ctx.reply(`User ${id} ko group se kick kar diya.`); }
  catch (err) { await ctx.reply(`Kick nahi ho paaya: ${err.message}`); }
});
bot.command('warn', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = targetUserId(ctx);
  if (!id) return ctx.reply('Kisi user ke message par reply karke /warn bhejo.');
  const cfg = chatSettings(ctx.chat.id);
  cfg.warnings[id] = (cfg.warnings[id] || 0) + 1;
  const count = cfg.warnings[id];
  saveState();
  if (count >= 3) {
    try { await ctx.telegram.banChatMember(ctx.chat.id, Number(id)); cfg.warnings[id] = 0; saveState(); await ctx.reply(`3 warnings complete: user ${id} ban kar diya.`); }
    catch (err) { await ctx.reply(`Warning 3/3, lekin ban nahi ho paaya: ${err.message}`); }
  } else await logAdminAction(ctx, 'Warn user', `Target: ${id}; count: ${count}/3`); await ctx.reply(`User ${id} ko warning ${count}/3 mili.`);
});
bot.command('warnings', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = targetUserId(ctx) || getArg(ctx).split(/\s+/)[0];
  if (!id) return ctx.reply('Use: reply karke /warnings, ya /warnings <user_id>.');
  await ctx.reply(`User ${id} warnings: ${chatSettings(ctx.chat.id).warnings[id] || 0}/3`);
});
bot.command('clear', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const count = Math.min(50, Math.max(1, Number(getArg(ctx)) || 10));
  const start = ctx.message.reply_to_message?.message_id || ctx.message.message_id;
  let deleted = 0;
  for (let i = 0; i < count; i++) { try { await archiveMessage(ctx, start - i, 'Admin clear archive'); await ctx.telegram.deleteMessage(ctx.chat.id, start - i); deleted++; } catch {} }
  await logAdminAction(ctx, 'Clear messages', `Count requested: ${count}; deleted: ${deleted}`); await ctx.reply(`${deleted} message(s) clear kar diye.`);
});
bot.command('lock', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  try { await ctx.telegram.setChatPermissions(ctx.chat.id, { can_send_messages: false }); chatSettings(ctx.chat.id).muted = true; saveState(); await ctx.reply('Group lock kar diya. Sirf admins message bhej sakte hain.'); }
  catch (err) { await ctx.reply(`Lock nahi ho paaya: ${err.message}`); }
});
bot.command('unlock', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  try { await ctx.telegram.setChatPermissions(ctx.chat.id, { can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true, can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true, can_add_web_page_previews: true, can_change_info: false, can_invite_users: true, can_pin_messages: false }); chatSettings(ctx.chat.id).muted = false; saveState(); await ctx.reply('Group unlock kar diya.'); }
  catch (err) { await ctx.reply(`Unlock nahi ho paaya: ${err.message}`); }
});
bot.command('welcome', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  if (!['on', 'off'].includes(value)) return ctx.reply('Use: /welcome on ya /welcome off');
  chatSettings(ctx.chat.id).welcome = value === 'on'; saveState(); await logAdminAction(ctx, `Welcome messages ${value}`); await ctx.reply(`Welcome messages ${value} ho gaye.`);
});
bot.command('autoreact', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  if (!['on', 'off'].includes(value)) return ctx.reply('Use: /autoreact on ya /autoreact off');
  chatSettings(ctx.chat.id).autoReact = value === 'on'; saveState(); await logAdminAction(ctx, `Auto reactions ${value}`); await ctx.reply(`Automatic emoji reactions ${value} ho gaye.`);
});
bot.command('antilink', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  if (!['on', 'off'].includes(value)) return ctx.reply('Use: /antilink on ya /antilink off');
  chatSettings(ctx.chat.id).antiLink = value === 'on'; saveState(); await logAdminAction(ctx, `Anti-link ${value}`); await ctx.reply(`Anti-link filter ${value} ho gaya.`);
});
bot.command('archive', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  if (!['on', 'off'].includes(value)) return ctx.reply('Use: /archive on ya /archive off');
  chatSettings(ctx.chat.id).archiveIncoming = value === 'on'; saveState();
  await logAdminAction(ctx, `Incoming archive ${value}`);
  await ctx.reply(`Incoming message archive ${value} ho gaya. ${value === 'on' ? 'Messages owner inbox mein snapshot honge.' : 'Naye snapshots band hain.'}`);
});
bot.command('flood', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const parts = getArg(ctx).split(/\s+/).filter(Boolean);
  const cfg = chatSettings(ctx.chat.id).flood;
  if (!parts.length) return ctx.reply(`Flood guard: ${cfg.enabled ? 'on' : 'off'}; max ${cfg.max} messages/${cfg.window}s; mute ${cfg.mute}s. Use /flood on|off or /flood on <max> <window_sec> <mute_sec>.`);
  if (['on', 'off'].includes(parts[0].toLowerCase())) cfg.enabled = parts[0].toLowerCase() === 'on';
  if (parts[1]) cfg.max = Math.min(30, Math.max(2, Number(parts[1]) || cfg.max));
  if (parts[2]) cfg.window = Math.min(120, Math.max(3, Number(parts[2]) || cfg.window));
  if (parts[3]) cfg.mute = Math.min(86400, Math.max(10, Number(parts[3]) || cfg.mute));
  saveState(); await logAdminAction(ctx, `Flood guard ${cfg.enabled ? 'on' : 'off'}`, `max=${cfg.max}, window=${cfg.window}s, mute=${cfg.mute}s`);
  await ctx.reply(`Flood guard ${cfg.enabled ? 'on' : 'off'}: ${cfg.max} messages/${cfg.window}s; mute ${cfg.mute}s.`);
});

bot.command('image', async ctx => {
  const prompt = getArg(ctx);
  if (!prompt) return ctx.reply('Use: /image <apna prompt>');
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('upload_photo');
    const image = await generateImage(prompt);
    await ctx.replyWithPhoto({ source: image.buffer, filename: `saaya-${Date.now()}.${image.mimeType.includes('jpeg') ? 'jpg' : 'png'}` }, { caption: `Image generated for: ${prompt.slice(0, 700)}` });
  } catch (err) {
    countError(ctx);
    console.error('Image generation error:', err.message);
    await ctx.reply('Image generate nahi ho paayi. Railway logs mein `Image generation error:` ke baad exact reason dekho.');
  }
});

bot.command('yt', async ctx => {
  const query = getArg(ctx).slice(0, 160);
  if (!query) return ctx.reply('Use: /yt <gaane ya video ka naam>');
  if (!YOUTUBE_API_KEY) return ctx.reply('YouTube search ke liye Railway Variables mein YOUTUBE_API_KEY add karo.');
  if (!youtubeSessionKey(ctx)) return ctx.reply('YouTube search personal Telegram account se chalao; anonymous/channel sender selection nahi kar sakta.');
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('typing');
    const results = await searchYouTubeVideos(query);
    if (!results.length) return ctx.reply('Is search ke liye koi public video result nahi mila.');
    const key = youtubeSessionKey(ctx);
    youtubeSessions.set(key, { step: 'choose_video', results, expiresAt: Date.now() + YOUTUBE_SESSION_TTL_MS });
    await ctx.reply('YouTube results — jis video ko chahiye uska number bhejo (1–5). Selection 10 minute valid rahegi.');
    for (const [index, item] of results.entries()) {
      const caption = `${index + 1}. ${item.title}\nChannel: ${item.channel}\n${item.url}`;
      if (item.thumbnail) {
        try { await ctx.replyWithPhoto(item.thumbnail, { caption }); }
        catch { await ctx.reply(caption); }
      } else await ctx.reply(caption);
    }
  } catch (err) {
    countError(ctx);
    console.error('YouTube search failed:', err.message);
    await ctx.reply('YouTube search nahi ho paayi. API key, YouTube Data API v3 enablement, quota aur Railway logs check karo.');
  }
});
bot.command('cancel', async ctx => {
  const key = youtubeSessionKey(ctx);
  if (key) youtubeSessions.delete(key);
  await ctx.reply('Pending YouTube selection cancel kar di.');
});
bot.command('ytmp3', ctx => handleYouTubeMedia(ctx, 'mp3'));
bot.command('ytmp4', ctx => handleYouTubeMedia(ctx, 'mp4'));

bot.command('memory', async ctx => {
  if (ctx.chat.type !== 'private') return ctx.reply('Conversation memory sirf private DM mein available hai.');
  const val = getArg(ctx).toLowerCase();
  const prefs = userSettings(ctx.from.id);
  if (!['on', 'off'].includes(val)) return ctx.reply(`DM memory: ${prefs.memory === false ? 'off' : 'on'}. Use /memory on or /memory off. Clear saved history with /resetmemory.`);
  prefs.memory = val === 'on';
  if (val === 'off') delete state.memories[userKey(ctx)];
  saveState();
  await ctx.reply(val === 'off' ? 'Memory off; saved DM history bhi clear kar di.' : 'Memory on. Recent DM turns context ke liye Railway storage par save honge; /memory off ya /resetmemory se control karo.');
});
bot.command('resetmemory', async ctx => {
  if (ctx.chat.type !== 'private') return ctx.reply('Memory controls sirf private DM mein available hain.');
  delete state.memories[userKey(ctx)];
  saveState();
  await ctx.reply('Tumhari saved DM conversation memory clear kar di.');
});

async function runAICommand(ctx, prompt, { remember = false } = {}) {
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('typing');
    const reply = await askGemini(ctx, prompt, { remember });
    await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true });
    await chooseGeminiReaction(ctx, prompt, reply);
  } catch (err) {
    countError(ctx);
    console.error('Gemini error:', err.message);
    await ctx.reply('Bamde reply dungi abhi time nhi hai mere pass.😐', { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true }).catch(() => {});
  }
}
bot.command('summarize', ctx => {
  const text = getArg(ctx) || ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
  if (!text) return ctx.reply('Kisi text message par reply karke /summarize bhejo, ya /summarize <text> likho.');
  return runAICommand(ctx, `Summarize this text in the same language. Keep the important points and be concise:\n${text}`, { remember: false });
});

bot.on('new_chat_members', async ctx => {
  if (!isGroup(ctx) || !chatSettings(ctx.chat.id).welcome) return;
  const names = (ctx.message.new_chat_members || []).map(u => u.first_name).join(', ');
  const welcome = await generateWelcomeMessage(names, ctx.chat.title || '');
  await ctx.reply(welcome);
});
bot.on('text', async (ctx, next) => {
  if (youtubeSessionKey(ctx) && youtubeSessions.has(youtubeSessionKey(ctx))) return handleYouTubeSelection(ctx, next);
  return next();
});
bot.on('text', async ctx => {
  const message = ctx.message;
  await archiveIncomingMessage(ctx);
  if (await applyFloodGuard(ctx)) return;
  if (isGroup(ctx) && chatSettings(ctx.chat.id).antiLink && message?.text && /https?:\/\/|t\.me\//i.test(message.text) && !(await isAdmin(ctx))) {
    await archiveMessage(ctx, message.message_id, 'Anti-link message removed');
    await removeMessage(ctx, message.message_id);
    return ctx.reply('Links sirf admins share kar sakte hain.');
  }
  await next();
});
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return;
  if (isGroup(ctx) && !addressedToSaaya(ctx)) return;
  return runAICommand(ctx, text, { remember: ctx.chat.type === 'private' });
});

bot.catch((err, ctx) => {
  console.error(`Telegram update ${ctx.update?.update_id} failed:`, err.message);
});

// Long polling: run a single Railway replica for each Telegram bot token.
bot.launch({ dropPendingUpdates: false }).then(() => console.log(`${BOT_NAME} is running with Gemini (${GEMINI_MODEL}).`));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

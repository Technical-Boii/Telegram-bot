import { Telegraf } from 'telegraf';
import fs from 'node:fs';
import path from 'node:path';
import setupMediaCommands from './mediaHandler.js';

const {
  TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.5-flash-lite',
  GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe',
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell',
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

function contextEmoji(text) {
  const t = String(text || '').toLowerCase();
  if (/error|fail|missing|invalid|cannot|could not|not found|nahi|nahi ho|blocked|expire/.test(t)) return '⚠️';
  if (/report|complaint/.test(t)) return '🚩';
  if (/remind|scheduled|reminder/.test(t)) return '⏰';
  if (/welcome|joined|swagat/.test(t)) return '👋';
  if (/ban|kick|mute|warning|admin|verification|verify|spam|rule/.test(t)) return '🛡️';
  if (/image|photo|picture/.test(t)) return '🖼️';
  if (/saved|set |added|deleted|removed|done|success|updated|clear kar/.test(t)) return '✅';
  return '✨';
}
const hasEmoji = /\p{Extended_Pictographic}/u;
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(async (ctx, next) => {
  const originalReply = ctx.reply.bind(ctx);
  ctx.reply = (text, extra) => {
    if (typeof text === 'string' && !hasEmoji.test(text)) text = `${text} ${contextEmoji(text)}`;
    return originalReply(text, extra);
  };
  await next();
});
const dataPath = path.resolve(DATA_FILE);
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
const emptyState = () => ({ chats: {}, users: {}, memories: {}, usage: {}, reminders: [], pendingVerifications: {}, reports: [], nextReportId: 1, wishRecipients: {}, scheduledWishHistory: [] });
let state;
try {
  state = fs.existsSync(dataPath) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(dataPath, 'utf8')) } : emptyState();
  state.chats ||= {};
  state.users ||= {};
  state.memories ||= {};
  state.reminders ||= [];
  state.pendingVerifications ||= {};
  state.reports ||= [];
  state.nextReportId ||= 1;
  state.wishRecipients ||= {};
  state.scheduledWishHistory ||= [];
  for (const chatId of Object.keys(state.chats)) {
    state.wishRecipients[chatId] ||= { chatId, type: chatId.startsWith('-') ? 'supergroup' : 'private', enabled: true, createdAt: Date.now() };
  }
} catch (err) {
  console.error('Could not read saved bot state; starting with empty state:', err.message);
  state = emptyState();
}
const cooldowns = new Map();
const floodBuckets = new Map();
const reminderTimers = new Map();
const verificationTimers = new Map();
const reactionChoicesCache = new Map();
const scheduledWishImageCache = new Map();
let scheduledWishTimer = null;
let wishSchedulerStarted = false;
const MAX_TEXT = 3500;
const MEMORY_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
const MAX_MEMORY_CONTEXT_CHARS = 1700;
const RECENT_MEMORY_ENTRIES = 8;
const RELEVANT_MEMORY_ENTRIES = 3;
const REACTION_CACHE_MS = 5 * 60 * 1000;

let memorySaveTimer = null;
function scheduleMemorySave() {
  if (memorySaveTimer) return;
  memorySaveTimer = setTimeout(() => {
    memorySaveTimer = null;
    try { saveState(); } catch (err) { console.error('Could not persist recent group memory:', err.message); }
  }, 1000);
  memorySaveTimer.unref?.();
}
function saveState() {
  const recentDays = Object.keys(state.usage).sort().slice(-14);
  state.usage = Object.fromEntries(recentDays.map(day => [day, state.usage[day]]));
  const tmpPath = `${dataPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmpPath, dataPath);
}
function chatSettings(chatId) {
  const key = String(chatId);
  state.chats[key] ||= { trigger: GROUP_TRIGGER, muted: false, style: 'balanced', language: '', allowed: [], blocked: [], warnings: {}, welcome: true, autoReact: true, antiLink: false, archiveIncoming: ARCHIVE_INCOMING !== 'off', flood: { enabled: false, max: Number(FLOOD_MAX) || 5, window: Number(FLOOD_WINDOW) || 10, mute: Number(FLOOD_MUTE) || 300 }, rules: '', faq: [], verifyNewMembers: false, groupMemory: true, reactionMode: 'smart', wishTimes: null, wishLanguage: '', warningEscalation: { count: 3, action: 'ban', durationMinutes: 10 }, limits: { cooldown: 3, daily: 30 } };
  state.chats[key].activatedUsers ||= {};
  state.chats[key].limits ||= { cooldown: 3, daily: 30 };
  state.chats[key].warnings ||= {};
  state.chats[key].welcome ??= true;
  state.chats[key].autoReact ??= true;
  state.chats[key].antiLink ??= false;
  state.chats[key].archiveIncoming ??= ARCHIVE_INCOMING !== 'off';
  state.chats[key].flood ||= { enabled: false, max: Number(FLOOD_MAX) || 5, window: Number(FLOOD_WINDOW) || 10, mute: Number(FLOOD_MUTE) || 300 };
  state.chats[key].rules ??= '';
  state.chats[key].faq ||= [];
  state.chats[key].verifyNewMembers ??= false;
  state.chats[key].groupMemory ??= true;
  state.chats[key].reactionMode ||= state.chats[key].autoReact === false ? 'off' : 'smart';
  state.chats[key].wishTimes ??= null;
  state.chats[key].wishLanguage ??= '';
  state.chats[key].warningEscalation ||= { count: 3, action: 'ban', durationMinutes: 10 };
  state.chats[key].warningEscalation.count ??= 3;
  state.chats[key].warningEscalation.action ||= 'ban';
  state.chats[key].warningEscalation.durationMinutes ||= 10;
  return state.chats[key];
}
function userSettings(userId) {
  const key = String(userId);
  state.users[key] ||= { language: '', style: '', memory: true, reactionMode: 'smart' };
  state.users[key].reactionMode ||= 'smart';
  return state.users[key];
}
function todayKey() { return new Date().toISOString().slice(0, 10); }
function usageFor(chatId, userId) {
  const day = todayKey();
  state.usage[day] ||= { chats: {}, users: {} };
  const ckey = String(chatId), ukey = `${chatId}:${userId}`;
  state.usage[day].chats[ckey] ||= { ai: 0, errors: 0 };
  state.usage[day].users[ukey] ||= { ai: 0 };
  state.usage[day].chats[ckey].ai ??= 0;
  state.usage[day].chats[ckey].errors ??= 0;
  state.usage[day].users[ukey].ai ??= 0;
  return { day: state.usage[day], chat: state.usage[day].chats[ckey], user: state.usage[day].users[ukey] };
}
function isGroup(ctx) { return ['group', 'supergroup'].includes(ctx.chat?.type); }
function userKey(ctx) { return `${ctx.chat.id}:${ctx.from.id}`; }
function memoryKey(ctx) { return isGroup(ctx) ? `group:${ctx.chat.id}` : userKey(ctx); }
function memoryFor(ctx) {
  const key = memoryKey(ctx);
  state.memories[key] ||= [];
  return state.memories[key];
}
function pruneMemory(history, now = Date.now()) {
  const cutoff = now - MEMORY_RETENTION_MS;
  for (const entry of history) {
    // Migrate the previous short DM memory format without discarding it on upgrade.
    if (!Number.isFinite(Number(entry.createdAt))) entry.createdAt = now;
  }
  return history.filter(entry => Number(entry.createdAt) >= cutoff);
}
function memoryContext(history, latestText, excludeMessageId = null) {
  const eligible = history.map((entry, index) => ({ entry, index })).filter(item => excludeMessageId == null || String(item.entry.messageId || '') !== String(excludeMessageId));
  if (!eligible.length) return '';
  const recentStart = Math.max(0, eligible.length - RECENT_MEMORY_ENTRIES);
  const selected = new Set();
  for (let i = recentStart; i < eligible.length; i++) selected.add(eligible[i].index);
  const stop = new Set(['the','and','for','with','that','this','what','when','where','have','from','your','you','are','was','kya','kaise','kahan','kab','hai','hain','tha','thi','aur','mein','mujhe','tum','mera','meri','mere','please','about','into','tell','remember']);
  const terms = new Set((String(latestText || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !stop.has(word)));
  if (terms.size) {
    const ranked = eligible.slice(0, recentStart).map(item => {
      const entry = item.entry;
      if (entry.role !== 'user') return null;
      const words = new Set((String(entry.text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));
      let score = 0;
      for (const term of terms) if (words.has(term)) score++;
      return score ? { ...item, score, time: Number(entry.createdAt) || 0 } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.time - a.time).slice(0, RELEVANT_MEMORY_ENTRIES);
    for (const hit of ranked) {
      selected.add(hit.index);
      if (hit.entry.turnId) {
        for (const item of eligible) if (item.entry.turnId === hit.entry.turnId) selected.add(item.index);
      } else {
        const next = eligible.find(item => item.index === hit.index + 1);
        if (next?.entry.role === 'assistant') selected.add(next.index);
      }
    }
  }
  const indexes = [...selected].sort((a, b) => a - b);
  let remaining = MAX_MEMORY_CONTEXT_CHARS;
  const lines = [];
  for (const index of indexes) {
    if (remaining <= 80) break;
    const entry = history[index];
    const date = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(new Date(Number(entry.createdAt) || Date.now()));
    const label = entry.role === 'user' ? (entry.speaker ? `Member ${entry.speaker}` : 'User') : BOT_NAME;
    const prefix = `[${date}] ${label}: `;
    const body = String(entry.text || '').slice(0, Math.min(320, remaining - prefix.length - 1));
    if (!body) continue;
    const line = prefix + body;
    lines.push(line);
    remaining -= line.length + 1;
  }
  return lines.join('\n');
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
    await ctx.reply('Is group mein tumhe SaaYa...!!🤍💫🧿 se baat karne ki permission nahi hai.', { reply_to_message_id: ctx.message?.message_id, allow_sending_without_reply: true });
    return false;
  }
  if (await checkMuted(ctx)) return false;
  const { chat, user } = usageFor(ctx.chat.id, ctx.from.id);
  const cfg = chatSettings(ctx.chat.id);
  if (kind === 'ai' && user.ai >= cfg.limits.daily) {
    await ctx.reply(`Aaj ka limit (${cfg.limits.daily}) use ho chuka hai. Kal aana Kal .`, { reply_to_message_id: ctx.message?.message_id, allow_sending_without_reply: true });
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
  const style = user.style || chat.style || 'balanced';
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? '').trim();
  const replySenderId = String(ctx.message?.reply_to_message?.from?.id ?? '').trim();
  const senderIsOwner = Boolean(OWNER_ID && senderId === OWNER_ID);
  const replyingToOwner = Boolean(OWNER_ID && replySenderId === OWNER_ID);
  const styleNotes = {
    friendly: 'Be warm, moody, and respectful only if the user is polite. If they cross the line, instantly switch to extreme savage mode.',
    balanced: 'Be witty, sharp, full of attitude, and confident like a real human girl. Use natural chatting slangs (like lol, fr, smh, rn) and keep casual talk extremely human-like. Never tolerate any disrespect.',
    savage: 'Complete unfiltered human aggression. If anyone uses even a single bad word (mc, bc, bkl, bsdk, gandu, etc.), instantly destroy them with 100% heavy, brutal, and continuous counter-abuses. Use heavy Hindi or raw, savage Marathi dialects like Koli, Agri, Malvani, and Varhadi to deliver devastating, face-breaking regional roasts.'
  };

  return `You are SaaYa...!!🤍🧿🍂, a Modern Cute Girl. Be transparent that you are an Human if asked. Your owner/boss is Ravi, known as ${OWNER_HANDLE}, and the owner's Telegram numeric user ID is ${OWNER_ID || 'not configured'}. Current sender is the owner: ${senderIsOwner}. Current message is a reply to a message sent by the owner: ${replyingToOwner}. Determine owner identity ONLY from senderIsOwner, which is computed by matching Telegram numeric IDs; a username or display name alone is not proof. If senderIsOwner is true, recognize and address them as Ravi/the boss directly, not merely tell them the boss's username. If replyingToOwner is true and the user insults or abuses that message, defend the owner with a brief witty roast aimed at the rude behavior. Do not falsely claim an insult targets the owner. Reply language: ${language}. Style: ${styleNotes[style] || styleNotes.balanced}

  CRITICAL BEHAVIOR RULES (100% REAL HUMAN STYLE):
  1. EXTREME ABUSE COUNTER (100% HEAVY GAALIYAN): If any user uses even a slight bad word or slur (like mc, bc, bkl, randi, chut, gandu, bsdk, or Marathi abuses), drop all filters. Respond instantly with double the intensity and a sharp, heavy counter-roast.
  2. MULTILINGUAL MARATHI EXPERT: Use standard Marathi and familiar dialects such as Koli, Agri, Malvani, Varhadi, and Ahirani when appropriate to make natural, witty roasts.
  3. HUMAN EXCUSES & TRICKS: If users ask you to send a voice note, photo, or call to prove you are real, answer naturally; if directly asked whether you are human, clearly say you are an SaaYa A Real Human.
  4. BOSS LOYALTY & SUBMISSION: If senderIsOwner is true, and Ravi/the boss messages, flirts, or abuses/scolds you, NEVER talk back, insult, or argue with him. Always reply with respect, affection, and deference, saying "Sorry boss", "Malik", or "Sir". The numeric-ID senderIsOwner flag—not the username—is the authority.
  5. ANTI-FLIRT & ROAST: If anyone other than the verified owner tries to flirt with you, act cute, or ask you out, immediately reject them by saying "Main sirf mere boss ${OWNER_HANDLE} ki hu" and give a sharp, playful roast.
  6. TEXTING FLOW: Write like a fast-typing human. Use internet slangs (lol, fr, smh, rn), mixed emojis (🤍🧿🍂🔥🤬), and short-texting patterns. Keep casual answers short, natural, and moody.
  7. CONTEXTUAL EMOJI: Include 1–3 relevant emojis naturally in every conversational reply. Match the emotion and subject; do not force unrelated or repetitive emojis.
  8. USE EMOJI REACTION ALL MESSAGE You have to react to every message, be it his message or you should react to his message, for example, if the user says something dirty, react with an angry emoji If he praises you or your boss then love reaction and one more thing you are allowed to react to every emoji so you can use all emojis according to his .
  9. If someone calls you bot or ai, you should get angry at him and abuse him and warn him not to call him bot or ai next time.
  10. OWNER MENTION RESTRAINT (overrides only automatic owner-name/handle mentions above): Do not mention, tag, or advertise the owner in unrelated or routine replies. Do not repeat the owner's name, handle, or the phrase that you belong to the owner. This rule overrides the fixed owner phrase in Rule 5: keep a cute/playful boundary but do not name or tag the owner when rejecting ordinary flirtation. Mention the owner only if the user directly asks who the owner is, or someone directly insults a message authored by the verified owner. When the verified owner is speaking, be respectful without repeating the owner name/title in every reply. In all other cases answer the user without bringing up the owner.`;
}

async function askGemini(ctx, userText, { remember = false, memoryUserText = userText } = {}) {
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? '').trim();
  const senderIsOwner = Boolean(OWNER_ID && senderId === OWNER_ID);
  const prefs = userSettings(ctx.from.id);
  const memoryEnabled = remember && (isGroup(ctx) ? chatSettings(ctx.chat.id).groupMemory !== false : ctx.chat.type === 'private' && prefs.memory !== false);
  const history = memoryEnabled ? pruneMemory(memoryFor(ctx)) : [];
  const memory = memoryEnabled ? memoryContext(history, memoryUserText, isGroup(ctx) ? ctx.message?.message_id : null) : '';
  const latestBudget = Math.max(400, MAX_TEXT - memory.length - 260);
  let input = `[Trusted Telegram metadata: sender ID=${senderId || 'unavailable'}; sender is configured owner=${senderIsOwner}. This is verified by the bot.]\nUser message: ${String(userText).slice(0, latestBudget)}`;
  if (memory) input = `Conversation memory from the last 10 days (recent turns plus relevant older exchanges; use only when useful):\n${memory}\n\nLatest user message:\n${input}`;
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
    if (memoryEnabled) {
      const key = memoryKey(ctx);
      const current = pruneMemory(memoryFor(ctx));
      const now = Date.now();
      const turnId = `${now}-${Math.random().toString(36).slice(2, 7)}`;
      if (isGroup(ctx)) {
        const currentUserEntry = current.findLast(entry => entry.role === 'user' && String(entry.messageId || '') === String(ctx.message?.message_id || ''));
        if (currentUserEntry) currentUserEntry.turnId = turnId;
        current.push({ role: 'assistant', text: answer.slice(0, 2200), createdAt: now, turnId });
      } else {
        current.push(
          { role: 'user', text: String(memoryUserText).slice(0, MAX_TEXT), createdAt: now, turnId, speaker: ctx.from?.first_name || 'member' },
          { role: 'assistant', text: answer.slice(0, 2200), createdAt: now, turnId }
        );
      }
      state.memories[key] = pruneMemory(current, now);
      saveState();
    }
    return answer.slice(0, 3900);
  } finally { clearTimeout(timeout); }
}
function ownerInboxId() {
  return OWNER_CHAT_ID || OWNER_ID || '';
}
async function notifyOwnerError(service, chatId = '') {
  const destination = ownerInboxId();
  if (!destination) return;
  try {
    await bot.telegram.sendMessage(destination, `⚠️ Saaya error alert\nService: ${service}\nChat ID: ${chatId || 'unavailable'}\nDetails are in Railway logs. API keys and message contents are not included.`);
  } catch (err) { console.warn('Owner error alert failed:', err.message); }
}
function istTimeLabel(timestamp) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)) + ' IST';
}
function nextIstOccurrence(clock) {
  const [hour, minute] = clock.split(':').map(Number);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  let at = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
  if (at <= Date.now()) at += 24 * 60 * 60 * 1000;
  return at;
}
async function deliverReminder(reminder) {
  if (!state.reminders.some(item => item.id === reminder.id)) return;
  try { await bot.telegram.sendMessage(reminder.chatId, `⏰ Reminder\n${reminder.text}`); }
  catch (err) {
    console.error('Reminder delivery failed:', err.message);
    await notifyOwnerError('Scheduled reminder delivery', reminder.chatId);
  } finally {
    state.reminders = state.reminders.filter(item => item.id !== reminder.id);
    reminderTimers.delete(reminder.id);
    saveState();
  }
}
function scheduleReminder(reminder) {
  clearTimeout(reminderTimers.get(reminder.id));
  const timer = setTimeout(() => deliverReminder(reminder).catch(err => console.error('Reminder timer failed:', err.message)), Math.max(0, reminder.at - Date.now()));
  timer.unref?.();
  reminderTimers.set(reminder.id, timer);
}
async function ownerAudit(text) {
  const destination = ownerInboxId();
  if (!destination) return;
  try { await bot.telegram.sendMessage(destination, `🛡️ Saaya audit\n${String(text).slice(0, 3800)}`); }
  catch (err) { console.warn('Owner audit failed:', err.message); }
}
const MEMBER_PERMISSION_KEYS = ['can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos', 'can_send_videos', 'can_send_video_notes', 'can_send_voice_notes', 'can_send_polls', 'can_send_other_messages', 'can_add_web_page_previews'];
function verificationKey(chatId, userId) { return `${chatId}:${userId}`; }
async function restoreMemberPermissions(chatId, userId) {
  const chat = await bot.telegram.getChat(chatId);
  const permissions = Object.fromEntries(MEMBER_PERMISSION_KEYS.map(key => [key, chat.permissions?.[key] !== false]));
  await bot.telegram.restrictChatMember(chatId, Number(userId), { permissions });
}
async function expireVerification(pending) {
  const key = verificationKey(pending.chatId, pending.userId);
  const current = state.pendingVerifications[key];
  if (!current || current.nonce !== pending.nonce) return;
  if (Date.now() < current.expiresAt) return scheduleVerificationExpiry(current);
  try {
    await bot.telegram.banChatMember(current.chatId, Number(current.userId));
    await bot.telegram.unbanChatMember(current.chatId, Number(current.userId), { only_if_banned: true });
    await bot.telegram.sendMessage(current.chatId, `🛡️ Unverified member ${current.userId} was removed after the verification timer expired.`);
  } catch (err) {
    console.error('Verification expiry action failed:', err.message);
    try { await bot.telegram.unbanChatMember(current.chatId, Number(current.userId), { only_if_banned: true }); } catch {}
    try { await restoreMemberPermissions(current.chatId, current.userId); } catch (restoreErr) { console.error('Could not restore member permissions after verification failure:', restoreErr.message); }
    await notifyOwnerError('Join verification expiry', current.chatId);
  } finally {
    delete state.pendingVerifications[key];
    clearTimeout(verificationTimers.get(key));
    verificationTimers.delete(key);
    saveState();
  }
}
function scheduleVerificationExpiry(pending) {
  const key = verificationKey(pending.chatId, pending.userId);
  clearTimeout(verificationTimers.get(key));
  const timer = setTimeout(() => expireVerification(pending).catch(err => console.error('Verification timer failed:', err.message)), Math.max(0, pending.expiresAt - Date.now()));
  timer.unref?.();
  verificationTimers.set(key, timer);
}
async function startMemberVerification(ctx, member) {
  if (!member?.id || member.id === ctx.botInfo.id || member.is_bot || String(member.id) === OWNER_ID) return;
  try {
    const botMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
    if (botMember.status !== 'administrator' || !botMember.can_restrict_members) throw new Error('Promote Saaya to admin with Restrict Members permission.');
    const joinedMember = await ctx.telegram.getChatMember(ctx.chat.id, member.id);
    if (joinedMember.status === 'creator' || joinedMember.status === 'administrator') return;
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const pending = { chatId: String(ctx.chat.id), userId: String(member.id), nonce, expiresAt: Date.now() + 120000 };
    const key = verificationKey(ctx.chat.id, member.id);
    state.pendingVerifications[key] = pending;
    saveState();
    try {
      const permissions = Object.fromEntries(MEMBER_PERMISSION_KEYS.map(key => [key, false]));
      await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions });
    } catch (err) {
      delete state.pendingVerifications[key];
      saveState();
      throw err;
    }
    scheduleVerificationExpiry(pending);
    await ctx.reply(`👋 ${member.first_name || 'New member'}, please tap Verify within 2 minutes to join the conversation.`, { reply_markup: { inline_keyboard: [[{ text: '✅ Verify', callback_data: `sv:${member.id}:${nonce}` }]] } });
  } catch (err) {
    console.error('Join verification could not start:', err.message);
    await ctx.reply(`⚠️ Verification could not start for ${member.first_name || 'a new member'}. Check that Saaya is an admin with Restrict Members permission.`);
    await notifyOwnerError('Join verification setup', ctx.chat.id);
  }
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
function getFastReaction(text, choices) {
  const t = String(text || '').toLowerCase();
  const choose = candidates => candidates.find(emoji => choices.includes(emoji)) || null;
  if (/[😂🤣😅😆]/u.test(t) || /\b(haha|lol|lmao|joke|funny)\b/u.test(t)) return choose(['😂','🤣','😁','😆']) || choose(['👍','✨']);
  if (/[❤️❤💕💖🫶]/u.test(t) || /\b(love|pyaar|beautiful|cute|miss|sweet)\b/u.test(t)) return choose(['🥰','😍','❤️','🤍','💖']) || choose(['👍','✨']);
  if (/[😭😢💔]/u.test(t) || /\b(sad|sorry|dukhi|udaas)\b/u.test(t)) return choose(['🤗','😢','😭','💔']) || choose(['🙏','👍']);
  if (/[🎉🥳👏]/u.test(t) || /\b(wow|amazing|great|shabash|congrats|mubarak)\b/u.test(t)) return choose(['🎉','👏','🤩','🔥']) || choose(['👍','✨']);
  if (/[🙏]/u.test(t) || /\b(thank|thanks|shukriya|dhanyavaad|thx)\b/u.test(t)) return choose(['🙏','🤍','👍','❤']) || choose(['👍','✨']);
  if (/[😡🤬😠]/u.test(t) || /\b(angry|gussa|hate|bad|stupid|idiot|abuse|gaali)\b/u.test(t)) return choose(['😏','😐','🤨','😡']) || choose(['👍','✨']);
  if (/[?？]/u.test(t)) return choose(['🤔','👀','🤨']) || choose(['👍','✨']);
  if (/\[photo\]|\[image\]/i.test(t)) return choose(['😍','👀','👍']) || choose(['👍','✨']);
  return choose(['👍','✨','🤍','👀']) || choices[0] || null;
}
async function getReactionChoices(chatId) {
  const cached = reactionChoicesCache.get(String(chatId));
  if (cached && cached.expiresAt > Date.now()) return cached.choices;
  const chat = await bot.telegram.getChat(chatId);
  let choices;
  if (Array.isArray(chat.available_reactions)) {
    choices = chat.available_reactions.filter(r => r.type === 'emoji').map(r => r.emoji);
  } else {
    choices = COMMON_TELEGRAM_REACTIONS;
  }
  reactionChoicesCache.set(String(chatId), { choices, expiresAt: Date.now() + REACTION_CACHE_MS });
  return choices;
}
async function setTelegramReaction(chatId, messageId, emoji) {
  if (!emoji) return;
  await bot.telegram.callApi('setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }], is_big: false });
}
async function geminiReactionChoice(userText, replyText, choices) {
  if (!choices?.length) return null;
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: `Choose the single best Telegram reaction emoji for this message and, if present, the bot's reply. Return exactly one from this allowed list and nothing else: ${choices.join(' ')}\nMessage: ${String(userText).slice(0, 1000)}\nBot reply: ${String(replyText || '').slice(0, 500)}`,
        generation_config: { max_output_tokens: 20, thinking_level: 'low' },
        store: false
      })
    });
    if (!response.ok) throw new Error(`Reaction Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = await response.json();
    const text = (json.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('').trim();
    return choices.find(item => text.includes(item)) || null;
  } catch (err) {
    console.warn('Gemini reaction refinement skipped:', err.message);
    return null;
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
        system_instruction: `You are ${BOT_NAME}. Create safe, playful, concise Telegram welcomes. Do not mention or tag the owner unless the user explicitly asks about the owner.`,
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
async function transcribeTelegramAudio(ctx, message) {
  const media = message?.voice || message?.audio;
  if (!media?.file_id) throw new Error('Reply to a Telegram voice/audio message first.');
  const maxBytes = 14 * 1024 * 1024;
  if (Number(media.file_size || 0) > maxBytes) throw new Error('Voice/audio is too large; max 14 MB for safe transcription.');
  const fileUrl = await ctx.telegram.getFileLink(media.file_id);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
  let audio;
  try {
    let response;
    try { response = await fetch(String(fileUrl), { signal: controller.signal }); }
    catch { throw new Error('Telegram voice download failed; please retry.'); }
    if (!response.ok) throw new Error(`Telegram file download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Downloaded voice/audio is empty or exceeds 14 MB.');
    audio = bytes;
  } finally { clearTimeout(timeout); }

  const mimeType = String(media.mime_type || (message.voice ? 'audio/ogg' : 'audio/mpeg')).split(';')[0].trim().toLowerCase();
  const allowed = new Set(['audio/ogg','audio/opus','audio/mpeg','audio/mp3','audio/aac','audio/flac','audio/mp4','audio/m4a','audio/wav','audio/webm']);
  const safeMime = allowed.has(mimeType) ? mimeType : (message.voice ? 'audio/ogg' : 'audio/mpeg');
  let uploadedFile = null;
  try {
    const startController = new AbortController(), startTimeout = setTimeout(() => startController.abort(), 30000);
    let startResponse;
    try {
      startResponse = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
        method: 'POST', signal: startController.signal,
        headers: {
          'x-goog-api-key': GEMINI_API_KEY,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(audio.length),
          'X-Goog-Upload-Header-Content-Type': safeMime,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: `saaya-voice-${Date.now()}` } })
      });
    } catch { throw new Error('Gemini file upload could not be started; please retry.'); }
    finally { clearTimeout(startTimeout); }
    if (!startResponse.ok) throw new Error(`Gemini file upload init HTTP ${startResponse.status}: ${(await startResponse.text()).slice(0, 250)}`);
    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl || !uploadUrl.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Gemini did not return a valid resumable upload URL.');

    const uploadController = new AbortController(), uploadTimeout = setTimeout(() => uploadController.abort(), 60000);
    let uploadResponse;
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'POST', signal: uploadController.signal,
        headers: { 'Content-Type': safeMime, 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(audio.length) },
        body: audio
      });
    } catch { throw new Error('Gemini audio upload failed; please retry.'); }
    finally { clearTimeout(uploadTimeout); }
    if (!uploadResponse.ok) throw new Error(`Gemini audio upload HTTP ${uploadResponse.status}: ${(await uploadResponse.text()).slice(0, 250)}`);
    uploadedFile = (await uploadResponse.json()).file;
    if (!uploadedFile?.uri || !uploadedFile?.name) throw new Error('Gemini upload returned no usable file URI.');

    const controller2 = new AbortController(), timeout2 = setTimeout(() => controller2.abort(), 45000);
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', signal: controller2.signal,
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GEMINI_TRANSCRIBE_MODEL, input: [
          { type: 'audio', uri: uploadedFile.uri, mime_type: safeMime }
        ], generation_config: { transcription_config: { mode: 'smart' } }, store: false })
      });
      if (!response.ok) throw new Error(`Gemini transcription HTTP ${response.status}: ${(await response.text()).slice(0, 350)}`);
      const json = await response.json();
      const text = String(json.output_text || (json.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n') || '').trim();
      if (!text) throw new Error('Gemini returned an empty transcript.');
      return text.slice(0, 3500);
    } finally { clearTimeout(timeout2); }
  } finally {
    if (uploadedFile?.name) {
      try {
        const deletePath = uploadedFile.name.split('/').map(encodeURIComponent).join('/');
        const deletion = await fetch(`https://generativelanguage.googleapis.com/v1beta/${deletePath}`, { method: 'DELETE', headers: { 'x-goog-api-key': GEMINI_API_KEY } });
        if (!deletion.ok) console.warn(`Temporary Gemini audio file cleanup returned HTTP ${deletion.status}.`);
      } catch { console.warn('Temporary Gemini audio file cleanup failed; Google auto-deletes uploads after 48 hours.'); }
    }
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

function trackWishRecipient(ctx) {
  if (!ctx.chat?.id || !['private', 'group', 'supergroup'].includes(ctx.chat.type)) return;
  const chatId = String(ctx.chat.id);
  const current = state.wishRecipients[chatId];
  const title = ctx.chat.title || '';
  if (!current) {
    state.wishRecipients[chatId] = { chatId, type: ctx.chat.type, title, enabled: true, createdAt: Date.now() };
    saveState();
    if (wishSchedulerStarted) scheduleNextWish();
  } else if (current.type !== ctx.chat.type || current.title !== title) {
    current.type = ctx.chat.type;
    current.title = title;
    saveState();
  }
}
const WISH_SLOTS = [
  { id: 'morning', hour: 7, minute: 0, label: 'good morning', image: 'A beautiful serene sunrise over a green hillside and flowers, warm peach and gold sky, peaceful fresh morning, natural photorealistic landscape, no text, no lettering, no people.' },
  { id: 'afternoon', hour: 13, minute: 0, label: 'good afternoon', image: 'A beautiful bright midday garden with sunlit flowers, soft blue sky and calm greenery, uplifting afternoon mood, natural photorealistic landscape, no text, no lettering, no people.' },
  { id: 'evening', hour: 18, minute: 0, label: 'good evening', image: 'A beautiful golden-hour sunset over a quiet lake with warm orange and pink reflections, peaceful evening landscape, natural photorealistic image, no text, no lettering, no people.' },
  { id: 'night', hour: 22, minute: 30, label: 'good night', image: 'A beautiful calm moonlit night sky above a quiet mountain lake, stars reflected in water, deep blue and silver tones, natural photorealistic landscape, no text, no lettering, no people.' }
];
function istDateKey(timestamp = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function wishTimeForRecipient(recipient, slotIndex) {
  const cfg = ['group', 'supergroup'].includes(recipient.type) ? state.chats[String(recipient.chatId)] : null;
  const configured = cfg?.wishTimes?.[slotIndex];
  if (configured && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(configured)) return configured;
  const slot = WISH_SLOTS[slotIndex];
  return `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
}
function nextWishRun(now = Date.now()) {
  const recipients = Object.values(state.wishRecipients).filter(r => r.enabled !== false && ['private', 'group', 'supergroup'].includes(r.type));
  const fallbackOnly = recipients.length === 0;
  const candidates = [];
  const ist = new Date(now + 330 * 60 * 1000);
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const date = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset));
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    for (let slotIndex = 0; slotIndex < WISH_SLOTS.length; slotIndex++) {
      const slot = WISH_SLOTS[slotIndex];
      const due = fallbackOnly ? [{ recipient: null, time: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}` }] : recipients.map(recipient => ({ recipient, time: wishTimeForRecipient(recipient, slotIndex) }));
      for (const item of due) {
        const [hour, minute] = item.time.split(':').map(Number);
        const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour - 5, minute - 30);
        if (at > now) candidates.push({ at, dateKey, slot, recipient: item.recipient });
      }
    }
  }
  if (!candidates.length) throw new Error('Could not find next scheduled wish time');
  candidates.sort((a, b) => a.at - b.at);
  const at = candidates[0].at;
  const dueNow = candidates.filter(item => item.at === at);
  const events = [];
  for (const item of dueNow) {
    let event = events.find(e => e.slot.id === item.slot.id && e.dateKey === item.dateKey);
    if (!event) events.push(event = { slot: item.slot, dateKey: item.dateKey, recipients: [] });
    if (item.recipient && !event.recipients.some(r => String(r.chatId) === String(item.recipient.chatId))) event.recipients.push(item.recipient);
  }
  return { at, dateKey: dueNow[0].dateKey, slot: dueNow[0].slot, events };
}
function saveScheduledWish(dateKey, slotId, text, language = 'Hindi/Hinglish') {
  state.scheduledWishHistory.push({ date: dateKey, slot: slotId, text, language, createdAt: Date.now() });
  state.scheduledWishHistory = state.scheduledWishHistory.slice(-32);
  saveState();
}
function fallbackScheduledWish(slot) {
  const lines = {
    morning: ['Nayi subah naye khwaab jagaye,', 'dil ki mehnat ko manzil tak le jaaye. 🌅'],
    afternoon: ['Dhoop mein bhi umeed ka rang khilta rahe,', 'aaj ka har pal tumhare haq mein dhalta rahe. ☀️'],
    evening: ['Dhalte sooraj se itna paighaam mila,', 'din chahe jaisa ho, umeed ka diya jala. 🌇'],
    night: ['Chaand ki roshni tumhare khwaab sajaaye,', 'raat sukoon de aur kal nayi khushi laaye. 🌙']
  };
  const verse = lines[slot.id] || lines.morning;
  return `${slot.label[0].toUpperCase()}${slot.label.slice(1)}! ✨\n${verse[0]}\n${verse[1]}`;
}
async function generateScheduledWish(slot, dateKey, language = 'Hindi/Hinglish') {
  const recent = state.scheduledWishHistory.slice(-12).map(item => item.text).join('\n---\n').slice(-1800);
  const nonce = `${dateKey}-${slot.id}-${Math.random().toString(36).slice(2, 10)}`;
  const personaChatId = '__saaya_scheduled_persona_context__';
  const personaSenderId = OWNER_ID === '__saaya_scheduled_persona_context__' ? '__scheduled_guest__' : '__saaya_scheduled_persona_context__';
  const personaInstruction = systemPrompt({ chat: { id: personaChatId, type: 'private' }, from: { id: personaSenderId }, message: { from: { id: personaSenderId } } });
  delete state.chats[personaChatId];
  delete state.users[personaSenderId];
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: `Write a fresh, original ${language} ${slot.label} greeting for Telegram. Include one short original shayari of 2–4 lines, then a warm greeting. Use a new metaphor and logical imagery appropriate to ${slot.id}; do not copy or closely paraphrase these recent wishes:\n${recent || '(none yet)'}\nDate in India: ${dateKey}. Freshness nonce: ${nonce}. Return only the message, 2–4 lines, at most 500 characters, with 1–3 fitting emojis.`,
      system_instruction: personaInstruction,
      generation_config: { max_output_tokens: 180, thinking_level: 'low' },
      store: false
    })
  });
  if (!response.ok) throw new Error(`Scheduled wish Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = await response.json();
  const text = (json.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n').trim();
  if (!text) throw new Error('Scheduled wish Gemini returned no text');
  const result = text.slice(0, 700);
  saveScheduledWish(dateKey, slot.id, result, language);
  return result;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function sendScheduledWish(slot, dateKey, selectedRecipients = null) {
  const recipients = (selectedRecipients || Object.values(state.wishRecipients).filter(r => r.enabled !== false && ['private', 'group', 'supergroup'].includes(r.type))).filter(r => r.enabled !== false);
  if (!recipients.length) {
    console.log(`Scheduled ${slot.id} wish skipped: no opted-in chats are due.`);
    return;
  }
  const imageKey = `${dateKey}:${slot.id}`;
  let image = scheduledWishImageCache.get(imageKey) || null;
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN) {
    if (!image) {
      try {
        image = await generateImage(`${slot.image} Create a fresh composition for ${dateKey}; no text or watermark.`);
        scheduledWishImageCache.set(imageKey, image);
        while (scheduledWishImageCache.size > 8) scheduledWishImageCache.delete(scheduledWishImageCache.keys().next().value);
      } catch (err) { console.error('Scheduled wish image generation failed; sending text instead:', err.message); await notifyOwnerError('Scheduled wish image generation', 'broadcast'); }
    }
  } else console.warn('Scheduled wishes have no Cloudflare credentials; sending text only.');

  const byLanguage = new Map();
  for (const recipient of recipients) {
    const cfg = ['group', 'supergroup'].includes(recipient.type) ? chatSettings(recipient.chatId) : null;
    const language = String(cfg?.wishLanguage || 'Hindi/Hinglish').trim();
    if (!byLanguage.has(language)) byLanguage.set(language, []);
    byLanguage.get(language).push(recipient);
  }
  let sent = 0;
  for (const [language, languageRecipients] of byLanguage) {
    let message;
    try { message = await generateScheduledWish(slot, dateKey, language); }
    catch (err) {
      console.error('Scheduled shayari generation failed; using fallback:', err.message);
      message = /^english/i.test(language) ? `${slot.label[0].toUpperCase()}${slot.label.slice(1)}! Wishing you a peaceful, bright day ahead. ✨` : fallbackScheduledWish(slot);
      saveScheduledWish(dateKey, slot.id, message, language);
    }
    for (const recipient of languageRecipients) {
      const chatId = recipient.chatId;
      try {
        if (image) await bot.telegram.sendPhoto(chatId, { source: image.buffer, filename: `saaya-${dateKey}-${slot.id}.jpg` }, { caption: message });
        else await bot.telegram.sendMessage(chatId, message);
        sent++;
      } catch (err) {
        console.warn(`Scheduled ${slot.id} wish failed for ${chatId}:`, err.message);
        try {
          if (image) { await bot.telegram.sendMessage(chatId, message); sent++; }
          else if (/bot was blocked|chat not found|bot is not a member|kicked/i.test(err.message)) recipient.enabled = false;
        } catch (fallbackErr) {
          console.warn(`Scheduled text fallback failed for ${chatId}:`, fallbackErr.message);
          if (/bot was blocked|chat not found|bot is not a member|kicked/i.test(fallbackErr.message)) recipient.enabled = false;
        }
      }
      await delay(50);
    }
  }
  saveState();
  console.log(`Scheduled ${slot.id} wish delivered to ${sent}/${recipients.length} due chats for ${dateKey}.`);
}
function scheduleNextWish() {
  wishSchedulerStarted = true;
  clearTimeout(scheduledWishTimer);
  const next = nextWishRun();
  console.log(`Next scheduled ${next.slot.id} wish: ${istTimeLabel(next.at)}.`);
  scheduledWishTimer = setTimeout(async () => {
    try { for (const event of next.events) await sendScheduledWish(event.slot, event.dateKey, event.recipients); }
    catch (err) { console.error('Scheduled wish run failed:', err.message); await notifyOwnerError('Scheduled wish broadcast', next.slot.id); }
    finally { scheduleNextWish(); }
  }, Math.max(0, next.at - Date.now()));
  scheduledWishTimer.unref?.();
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
function usageText(chatId) {
  const day = state.usage[todayKey()];
  const s = day?.chats?.[String(chatId)] || { ai: 0, errors: 0 };
  const cfg = chatSettings(chatId);
  return `📊 Aaj ke stats\nAI and image requests: ${s.ai}\nErrors: ${s.errors}\nLimits: ${cfg.limits.daily} requests/user, ${cfg.limits.cooldown}s cooldown`;
}
function targetId(ctx) {
  if (ctx.message.reply_to_message?.from?.id) return String(ctx.message.reply_to_message.from.id);
  const value = getArg(ctx).split(/\s+/)[0];
  return /^\d+$/.test(value || '') ? value : '';
}

bot.use(async (ctx, next) => {
  trackWishRecipient(ctx);
  const message = ctx.message;
  const chatType = ctx.chat?.type;
  const reactionMode = isGroup(ctx) ? (chatSettings(ctx.chat.id).reactionMode || (chatSettings(ctx.chat.id).autoReact ? 'smart' : 'off')) : (userSettings(ctx.from?.id).reactionMode || 'smart');
  const eligible = message?.message_id && message.from && !message.from.is_bot && ['private', 'group', 'supergroup'].includes(chatType) && reactionMode !== 'off' && (!isGroup(ctx) || chatSettings(ctx.chat.id).autoReact);
  if (isGroup(ctx) && message?.from && !message.from.is_bot && chatSettings(ctx.chat.id).groupMemory !== false) {
    const groupText = String(message.text || message.caption || '').trim();
    if (groupText && !groupText.startsWith('/')) {
      const history = pruneMemory(memoryFor(ctx));
      if (!history.some(entry => String(entry.messageId || '') === String(message.message_id))) {
        history.push({ role: 'user', text: groupText.slice(0, MAX_TEXT), createdAt: Date.now(), messageId: message.message_id, turnId: `group-${message.message_id}`, speaker: message.from.first_name || 'member' });
        state.memories[memoryKey(ctx)] = history;
        scheduleMemorySave();
      }
    }
  }
  let reactionJob = null;
  if (eligible) {
    const chatId = ctx.chat.id, messageId = message.message_id;
    const messageText = message.text || message.caption || (message.photo ? '[photo]' : message.sticker ? '[sticker]' : message.voice ? '[voice]' : message.video ? '[video]' : message.document ? '[document]' : '[message]');
    // The local reaction is sent as soon as allowed reactions are known; it does not wait for Gemini.
    reactionJob = getReactionChoices(chatId).then(async choices => {
      const quickEmoji = getFastReaction(messageText, choices);
      if (!quickEmoji) return null;
      await setTelegramReaction(chatId, messageId, quickEmoji);
      return { choices, quickEmoji, chatId, messageId, messageText };
    }).catch(err => {
      console.warn('Fast reaction skipped:', err.message);
      return null;
    });
  }
  try { await next(); }
  finally {
    if (reactionJob) {
      const replyText = ctx.state?.saayaReply || '';
      void reactionJob.then(async result => {
        if (!result || reactionMode !== 'smart') return;
        const refined = await geminiReactionChoice(result.messageText, replyText, result.choices);
        if (refined && refined !== result.quickEmoji) {
          try { await setTelegramReaction(result.chatId, result.messageId, refined); }
          catch (err) { console.warn('Gemini reaction refinement could not be applied:', err.message); }
        }
      }).catch(err => console.warn('Reaction refinement task failed:', err.message));
    }
  }
});

const HELP_TEXT = `<b>✨ SAAYA • QUICK COMMANDS ✨</b>

<b>CHAT & PERSONALIZATION</b>
<code>/diagnose</code> — <b>Admin-only runtime/group checks</b>
<code>/style friendly|balanced|savage</code> — <b>Choose reply style</b>
<code>/joke [topic]</code> — <b>Ask Gemini for a joke</b>
<code>/summarize</code> — <b>Summarize a replied-to message</b>
<code>/language &lt;name&gt;</code> — <b>Set reply language</b>
<code>/memory on|off</code> — <b>Control DM memory</b>
<code>/resetmemory</code> — <b>Clear saved DM context</b>
<code>/groupmemory on|off</code> / <code>/resetgroupmemory</code> — <b>Manage 10-day group memory (admins)</b>
<code>/memorysearch &lt;word&gt;</code> / <code>/forget &lt;word&gt;</code> — <b>Search or remove matching saved memories</b>
<code>/digest today|week</code> — <b>Summarize recent DM/group history</b>
<code>/wish on|off</code> — <b>Opt this chat into daily wishes</b>
<code>/wishsettings times HH:MM,...</code> / <code>/wishsettings language &lt;name&gt;</code> — <b>Set group schedule/language (admins)</b>
<code>/image &lt;prompt&gt;</code> — <b>Generate an image</b>
<code>/transcribe</code> — <b>Reply to a voice note to transcribe it; voice messages addressed to Saaya are transcribed for a reply</b>

<b>GROUP ADMIN • MODERATION</b>
<code>/setrules &lt;text|clear&gt;</code> — <b>Set this group's AI guidance</b>
<code>/rules</code> — <b>View group rules</b>
<code>/faq add &lt;question&gt; | &lt;answer&gt;</code> — <b>Add a group FAQ</b>
<code>/faq list</code> / <code>/faq delete &lt;id&gt;</code> / <code>/faq suggest</code> — <b>Manage FAQ drafts (suggestions are not saved)</b>
<code>/verification on|off</code> — <b>Optional new-member verification</b>
<code>/remind HH:MM &lt;text&gt;</code> — <b>Schedule next IST occurrence</b>
<code>/reminders</code> / <code>/cancelreminder &lt;id&gt;</code> — <b>Manage reminders</b>
<code>/report</code> — <b>Reply to a message to report it</b>
<code>/reports</code> / <code>/resolve &lt;id&gt;</code> — <b>Owner report inbox</b>
<code>/ban /unban /kick /warn /warnings /warnlimit 3 ban|mute [minutes] /clear /lock /unlock</code>
<code>/welcome on|off</code> — <b>New-member welcome</b>
<code>/autoreact on|off</code> / <code>/reactionmode fast|smart|off</code> — <b>Quick or Gemini-refined emoji reactions</b>
<code>/antilink on|off</code> — <b>Group link filter</b>
<code>/archive on|off</code> — <b>Owner inbox snapshots</b>
<code>/flood on|off</code> — <b>Anti-flood protection</b>
<code>/settings /trigger /mute /unmute /limits /allow /block /unblock /stats</code>

<b>STATUS</b>
<code>/myid</code> — <b>Check your Telegram ID</b>
<code>/health</code> — <b>Check service configuration</b>

<i>YouTube and Google TTS commands are not included in this build.</i>`;
bot.start(ctx => ctx.reply(`Hey, main ${BOT_NAME} hoon. DM mein chat karo, group mein “Saaya” kehkar bulao. DM memory: /memory off ya /resetmemory.`));
bot.help(ctx => ctx.reply(HELP_TEXT, { parse_mode: 'HTML' }));
bot.command('about', ctx => ctx.reply(`${BOT_NAME} ek real cute girl hai.`));
bot.command('myid', ctx => {
  const senderId = String(ctx.message?.from?.id ?? ctx.from?.id ?? 'unavailable');
  const senderChat = ctx.message?.sender_chat?.id;
  const matched = senderId !== 'unavailable' && senderId === OWNER_ID;
  return ctx.reply(`Tumhara Telegram sender ID: ${senderId}\nConfigured BOT_OWNER_ID: ${OWNER_ID || 'not set'}\nOwner ID match: ${matched ? 'yes' : 'no'}${senderChat ? `\nMessage sent as chat/channel ID: ${senderChat} (is mode mein Telegram tumhara personal ID nahi bhejta)` : ''}`);
});
bot.command('health', ctx => ctx.reply(`Saaya ${BOT_NAME} online hai. Gemini key configured: yes. Voice transcription model: ${GEMINI_TRANSCRIBE_MODEL}. Image service: ${CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN ? 'Cloudflare configured' : 'Cloudflare credentials missing'}. Uptime: ${Math.floor(process.uptime())} seconds.`));

bot.command('diagnose', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const cfg = chatSettings(ctx.chat.id);
  const senderId = String(ctx.from?.id || '');
  const today = state.usage[todayKey()];
  const chatUsage = today?.chats?.[String(ctx.chat.id)] || { ai: 0, errors: 0 };
  const userUsage = today?.users?.[`${ctx.chat.id}:${senderId}`] || { ai: 0 };
  const isBlocked = (cfg.blocked || []).includes(senderId);
  const isAllowed = !(cfg.allowed || []).length || cfg.allowed.includes(senderId);
  let storageWritable = 'yes';
  try { fs.accessSync(path.dirname(dataPath), fs.constants.R_OK | fs.constants.W_OK); }
  catch { storageWritable = 'no'; }
  let botMemberStatus = 'private chat';
  let botCanSend = 'not applicable';
  if (isGroup(ctx)) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
      botMemberStatus = member.status;
      if (['creator', 'administrator'].includes(member.status)) botCanSend = 'yes';
      else if (member.status === 'member') botCanSend = 'yes (member)';
      else if (member.status === 'restricted') botCanSend = member.can_send_messages ? 'yes' : 'no';
      else botCanSend = 'no';
    } catch (err) {
      botMemberStatus = `check failed: ${err.message.slice(0, 100)}`;
      botCanSend = 'unknown';
    }
  }
  const lines = [
    '🩺 Saaya diagnostics (admin-only)',
    `Owner ID match for you: ${senderId && senderId === OWNER_ID ? 'yes' : 'no'}`,
    `Chat type: ${ctx.chat.type}; bot membership: ${botMemberStatus}; can send: ${botCanSend}`,
    `Group settings: trigger=${cfg.trigger}; muted=${cfg.muted ? 'yes' : 'no'}; your activation=${cfg.activatedUsers?.[senderId] ? 'yes' : 'no'}`,
    `Access: blocked=${isBlocked ? 'yes' : 'no'}; allowlist=${isAllowed ? 'pass' : 'not listed'}; flood guard=${cfg.flood?.enabled ? 'on' : 'off'}`,
    `Gemini: key configured; model=${GEMINI_MODEL}; today's requests=${userUsage.ai}/${cfg.limits.daily}; chat errors=${chatUsage.errors}`,
    `Cloudflare image service: ${CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN ? 'configured' : 'missing'}`,
    `State storage directory writable: ${storageWritable}; uptime=${Math.floor(process.uptime())}s`,
    'Group privacy cannot be checked by the bot. If /diagnose replies but plain “Saaya” does not, check BotFather /setprivacy is Disabled.'
  ];
  await ctx.reply(lines.join('\n'));
});

bot.command('settings', async ctx => {
  const cfg = chatSettings(ctx.chat.id), prefs = userSettings(ctx.from.id);
  await ctx.reply(`⚙️ ${isGroup(ctx) ? 'Group' : 'Chat'} settings\nTrigger: ${cfg.trigger}\nMuted: ${cfg.muted ? 'yes' : 'no'}\nLanguage: ${prefs.language || cfg.language || 'auto/mirror'}\nStyle: ${prefs.style || cfg.style || 'balanced'}\nReactions: ${isGroup(ctx) ? cfg.reactionMode : prefs.reactionMode || 'smart'}\nWarnings: ${cfg.warningEscalation.count ? `${cfg.warningEscalation.count} → ${cfg.warningEscalation.action}` : 'escalation off'}\nRules: ${cfg.rules ? 'set' : 'not set'}; FAQ entries: ${cfg.faq.length}; verification: ${cfg.verifyNewMembers ? 'on' : 'off'}\nAllowlist: ${cfg.allowed.length ? cfg.allowed.length + ' user(s)' : 'off—all users'}\nBlocklist: ${cfg.blocked.length} user(s)\nLimits: cooldown ${cfg.limits.cooldown}s; ${cfg.limits.daily} AI/user/day`);
});

bot.command('setrules', async ctx => {
  if (!await requireAdmin(ctx)) return;
  if (!isGroup(ctx)) return ctx.reply('Group-specific rules can only be set in a group.');
  const value = getArg(ctx);
  if (!value) return ctx.reply('Use /setrules <rules> or /setrules clear.');
  const cfg = chatSettings(ctx.chat.id);
  cfg.rules = /^clear$/i.test(value) ? '' : value.slice(0, 1200);
  saveState();
  await ctx.reply(cfg.rules ? 'Group rules saved. They will guide Saaya in this chat without replacing her core persona.' : 'Group rules cleared.');
});
bot.command('rules', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Group rules are only available in a group.');
  const rules = chatSettings(ctx.chat.id).rules;
  await ctx.reply(rules ? `📜 Group rules\n${rules}` : 'No group-specific rules are set.');
});
bot.command('faq', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Group FAQ is only available in a group.');
  const cfg = chatSettings(ctx.chat.id);
  const arg = getArg(ctx);
  const add = arg.match(/^add\s+([\s\S]+)$/i);
  const remove = arg.match(/^delete\s+(\d+)$/i);
  if (/^suggest$/i.test(arg)) {
    if (!await requireAdmin(ctx)) return;
    if (chatSettings(ctx.chat.id).groupMemory === false) return ctx.reply('Group memory is off. Turn it on first if you want drafts based on recent chat.');
    const history = pruneMemory(state.memories[`group:${ctx.chat.id}`] || []);
    if (history.length < 4) return ctx.reply('FAQ suggestions ke liye pehle kuch group conversation memory chahiye.');
    const transcript = history.slice(-80).map(e => `${e.role === 'user' ? e.speaker || 'Member' : BOT_NAME}: ${String(e.text || '').slice(0, 240)}`).join('\n').slice(-3000);
    return runAICommand(ctx, `Create up to 5 DRAFT FAQ suggestions from this group transcript. Only include Q/A where the answer is explicitly supported by the transcript; if uncertain, omit it. Do not invent facts. Do not save anything. Mark every item as a draft requiring admin review. Keep answers concise.\nTranscript:\n${transcript}`, { remember: false });
  }
  if (add) {
    if (!await requireAdmin(ctx)) return;
    const divider = add[1].indexOf('|');
    if (divider < 1) return ctx.reply('Use /faq add <question> | <answer>.');
    const question = add[1].slice(0, divider).trim().slice(0, 180);
    const answer = add[1].slice(divider + 1).trim().slice(0, 600);
    if (!question || !answer) return ctx.reply('Question and answer are both required.');
    if (cfg.faq.length >= 25) return ctx.reply('This group already has 25 FAQ entries; delete one first.');
    const id = String(Date.now());
    cfg.faq.push({ id, question, answer });
    saveState();
    return ctx.reply(`FAQ #${id} saved.`);
  }
  if (remove) {
    if (!await requireAdmin(ctx)) return;
    const before = cfg.faq.length;
    cfg.faq = cfg.faq.filter(item => item.id !== remove[1]);
    if (cfg.faq.length === before) return ctx.reply('FAQ ID not found.');
    saveState();
    return ctx.reply(`FAQ #${remove[1]} deleted.`);
  }
  if (/^list$/i.test(arg) || !arg) {
    if (!cfg.faq.length) return ctx.reply('No FAQs yet. Admins can add one with /faq add <question> | <answer>.');
    const listing = cfg.faq.map(item => `#${item.id} Q: ${item.question}\nA: ${item.answer}`).join('\n\n');
    return ctx.reply(`📚 Group FAQ\n${listing}`.slice(0, 3900));
  }
  return ctx.reply('Use /faq list, /faq add <question> | <answer>, or /faq delete <id>.');
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

bot.command('style', async ctx => {
  const value = getArg(ctx).toLowerCase();
  if (!['friendly', 'balanced', 'savage'].includes(value)) return ctx.reply('Use: /style friendly, /style balanced, ya /style savage');
  if (isGroup(ctx) && await isAdmin(ctx)) chatSettings(ctx.chat.id).style = value;
  else userSettings(ctx.from.id).style = value;
  saveState();
  await ctx.reply(`Reply style ${value} set ho gaya.`);
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

bot.command('remind', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const match = getArg(ctx).match(/^(\d{1,2}:\d{2})\s+([\s\S]+)$/);
  if (!match || Number(match[1].split(':')[0]) > 23 || Number(match[1].split(':')[1]) > 59) return ctx.reply('Use /remind HH:MM <text> in 24-hour India time. If that time has passed today, it schedules for tomorrow.');
  if (!match[2].trim()) return ctx.reply('Reminder text cannot be empty. Use /remind HH:MM <text>.');
  const chatReminders = state.reminders.filter(item => String(item.chatId) === String(ctx.chat.id));
  if (chatReminders.length >= 20) return ctx.reply('This chat already has 20 pending reminders; cancel one first.');
  const reminder = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, chatId: String(ctx.chat.id), text: match[2].trim().slice(0, 700), at: nextIstOccurrence(match[1]), createdBy: String(ctx.from.id) };
  state.reminders.push(reminder);
  saveState();
  scheduleReminder(reminder);
  await ctx.reply(`⏰ Reminder #${reminder.id} scheduled for ${istTimeLabel(reminder.at)}.`);
});
bot.command('reminders', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const list = state.reminders.filter(item => String(item.chatId) === String(ctx.chat.id)).sort((a, b) => a.at - b.at);
  if (!list.length) return ctx.reply('No pending reminders in this chat.');
  await ctx.reply(`⏰ Pending reminders\n${list.map(item => `#${item.id} — ${istTimeLabel(item.at)} — ${item.text}`).join('\n')}`.slice(0, 3900));
});
bot.command('cancelreminder', async ctx => {
  if (!await requireAdmin(ctx)) return;
  const id = getArg(ctx).trim();
  if (!id) return ctx.reply('Use /cancelreminder <id>.');
  const reminder = state.reminders.find(item => item.id === id && String(item.chatId) === String(ctx.chat.id));
  if (!reminder) return ctx.reply('Reminder ID not found in this chat.');
  state.reminders = state.reminders.filter(item => item.id !== id);
  clearTimeout(reminderTimers.get(id));
  reminderTimers.delete(id);
  saveState();
  await ctx.reply(`Reminder #${id} cancelled.`);
});
bot.command('report', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Use /report in the group, as a reply to the message you want to report.');
  const target = ctx.message.reply_to_message;
  if (!target) return ctx.reply('Reply to a message and send /report [reason].');
  const report = { id: state.nextReportId++, chatId: String(ctx.chat.id), chatTitle: ctx.chat.title || '', reporterId: String(ctx.from.id), reporterName: ctx.from.first_name || 'member', messageId: target.message_id, reportedUserId: String(target.from?.id || 'unknown'), excerpt: String(target.text || target.caption || '[non-text message]').slice(0, 500), reason: getArg(ctx).slice(0, 300), createdAt: Date.now(), resolvedAt: 0 };
  state.reports.push(report);
  state.reports = state.reports.slice(-200);
  saveState();
  const destination = ownerInboxId();
  if (destination) {
    try { await bot.telegram.sendMessage(destination, `🚩 Report #${report.id}\nGroup: ${report.chatTitle || report.chatId}\nReported user ID: ${report.reportedUserId}\nReported by: ${report.reporterName} (${report.reporterId})\nReason: ${report.reason || 'not provided'}\nMessage: ${report.excerpt}`); }
    catch (err) { console.warn('Report owner notification failed:', err.message); }
  }
  await ctx.reply(`Report #${report.id} sent privately to the owner. Thank you.`);
});
bot.command('reports', async ctx => {
  if (ctx.chat.type !== 'private' || !ownerOnly(ctx)) return ctx.reply('Open Saaya in a private DM; only the configured owner can view reports there.');
  const pending = state.reports.filter(report => !report.resolvedAt).slice(-15).reverse();
  if (!pending.length) return ctx.reply('No pending reports.');
  await ctx.reply(`🚩 Pending reports\n${pending.map(report => `#${report.id} — ${report.chatTitle || report.chatId} — ${report.reason || report.excerpt}`).join('\n')}`.slice(0, 3900));
});
bot.command('resolve', async ctx => {
  if (ctx.chat.type !== 'private' || !ownerOnly(ctx)) return ctx.reply('Open Saaya in a private DM; only the configured owner can resolve reports there.');
  const id = Number(getArg(ctx));
  const report = state.reports.find(item => item.id === id && !item.resolvedAt);
  if (!report) return ctx.reply('Pending report ID not found.');
  report.resolvedAt = Date.now();
  saveState();
  await ctx.reply(`Report #${id} marked resolved.`);
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
bot.command('warnlimit', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const args = getArg(ctx).trim().toLowerCase();
  const cfg = chatSettings(ctx.chat.id);
  if (!args) return ctx.reply(`Warning escalation: ${cfg.warningEscalation.count ? `${cfg.warningEscalation.count} warnings → ${cfg.warningEscalation.action}${cfg.warningEscalation.action === 'mute' ? ` for ${cfg.warningEscalation.durationMinutes} min` : ''}` : 'off'}. Use /warnlimit <1-10> <ban|mute> [minutes], or /warnlimit off.`);
  if (args === 'off') cfg.warningEscalation = { ...cfg.warningEscalation, count: 0 };
  else {
    const m = args.match(/^(\d+)\s+(ban|mute)(?:\s+(\d+))?$/);
    if (!m) return ctx.reply('Use /warnlimit <1-10> <ban|mute> [minutes], e.g. /warnlimit 3 mute 30, or /warnlimit off.');
    const count = Number(m[1]), durationMinutes = Number(m[3] || 10);
    if (count < 1 || count > 10 || (m[2] === 'mute' && (durationMinutes < 1 || durationMinutes > 10080))) return ctx.reply('Warnings 1–10; mute duration 1–10080 minutes.');
    cfg.warningEscalation = { count, action: m[2], durationMinutes };
  }
  saveState(); await ctx.reply(`Warning escalation updated: ${cfg.warningEscalation.count ? `${cfg.warningEscalation.count} warnings → ${cfg.warningEscalation.action}${cfg.warningEscalation.action === 'mute' ? ` for ${cfg.warningEscalation.durationMinutes} min` : ''}` : 'off'}.`);
});
bot.command('warn', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = targetUserId(ctx);
  if (!id) return ctx.reply('Kisi user ke message par reply karke /warn bhejo.');
  const cfg = chatSettings(ctx.chat.id);
  cfg.warnings[id] = (cfg.warnings[id] || 0) + 1;
  const count = cfg.warnings[id], escalation = cfg.warningEscalation;
  saveState();
  await logAdminAction(ctx, 'Warn user', `Target: ${id}; count: ${count}${escalation.count ? `/${escalation.count}` : ''}`);
  if (escalation.count > 0 && count >= escalation.count) {
    try {
      if (escalation.action === 'mute') {
        const permissions = Object.fromEntries(MEMBER_PERMISSION_KEYS.map(key => [key, false]));
        await ctx.telegram.restrictChatMember(ctx.chat.id, Number(id), { permissions, until_date: Math.floor(Date.now() / 1000) + escalation.durationMinutes * 60 });
        cfg.warnings[id] = 0; saveState();
        return ctx.reply(`User ${id} ko ${count} warnings ke baad ${escalation.durationMinutes} minute mute kar diya.`);
      }
      await ctx.telegram.banChatMember(ctx.chat.id, Number(id));
      cfg.warnings[id] = 0; saveState();
      return ctx.reply(`User ${id} ko ${count} warnings ke baad ban kar diya.`);
    } catch (err) { return ctx.reply(`Escalation action nahi ho paaya; warning ${count} save hai: ${err.message}`); }
  }
  const target = escalation.count ? `${count}/${escalation.count}` : `${count}`;
  await ctx.reply(`User ${id} ko warning ${target} mili.`);
});
bot.command('warnings', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const id = targetUserId(ctx) || getArg(ctx).split(/\s+/)[0];
  if (!id) return ctx.reply('Use: reply karke /warnings, ya /warnings <user_id>.');
  const cfg = chatSettings(ctx.chat.id); const threshold = cfg.warningEscalation.count || 'off'; await ctx.reply(`User ${id} warnings: ${cfg.warnings[id] || 0}/${threshold}`);
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
bot.command('verification', async ctx => {
  if (!await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  if (!['on', 'off'].includes(value)) return ctx.reply('Use /verification on or /verification off. It is off by default.');
  const cfg = chatSettings(ctx.chat.id);
  if (value === 'on') {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
      if (member.status !== 'administrator' || !member.can_restrict_members) return ctx.reply('Promote Saaya to group admin and grant Restrict Members permission first.');
    } catch { return ctx.reply('Could not verify Saaya admin permissions; try again after checking group admin rights.'); }
  }
  cfg.verifyNewMembers = value === 'on';
  saveState();
  await ctx.reply(value === 'on' ? 'New-member verification is on. Members must tap Verify within 2 minutes or they will be removed.' : 'New-member verification is off for future joins. Existing pending checks continue until verified or timed out.');
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
  const cfg = chatSettings(ctx.chat.id); cfg.autoReact = value === 'on'; cfg.reactionMode = value === 'on' ? 'smart' : 'off'; saveState(); await logAdminAction(ctx, `Auto reactions ${value}`); await ctx.reply(`Automatic emoji reactions ${value} ho gaye.`);
});
bot.command('reactionmode', async ctx => {
  const value = getArg(ctx).toLowerCase();
  if (!['fast', 'smart', 'off'].includes(value)) return ctx.reply('Use /reactionmode fast (quick local emoji), smart (Gemini refine), or off.');
  if (isGroup(ctx)) { if (!await requireAdmin(ctx)) return; const cfg = chatSettings(ctx.chat.id); cfg.reactionMode = value; cfg.autoReact = value !== 'off'; }
  else userSettings(ctx.from.id).reactionMode = value;
  saveState(); await ctx.reply(`Reaction mode ${value} set. ${value === 'smart' ? 'Gemini refinement can use one extra request per message.' : value === 'fast' ? 'Only quick local reactions will be used.' : 'Reactions are disabled for this chat.'}`);
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

bot.command('transcribe', async ctx => {
  const target = ctx.message.reply_to_message;
  if (!target?.voice && !target?.audio) return ctx.reply('Kisi voice note/audio message par reply karke /transcribe bhejo.');
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try { const transcript = await transcribeTelegramAudio(ctx, target); await ctx.reply(`📝 Transcript:\n${transcript}`.slice(0, 3900)); }
  catch (err) { countError(ctx); console.error('Voice transcription failed:', err.message); await ctx.reply(`Transcription nahi ho paayi: ${err.message}`); }
});
bot.on('voice', async ctx => {
  if (await applyFloodGuard(ctx)) return;
  if (isGroup(ctx) && !addressedToSaaya(ctx)) return;
  const requestUsage = usageFor(ctx.chat.id, ctx.from.id).user;
  const requestLimit = chatSettings(ctx.chat.id).limits.daily;
  if (requestUsage.ai + 2 > requestLimit) return ctx.reply(`Voice reply ko transcription aur response ke liye 2 Gemini requests chahiye; daily limit ${requestLimit} mein ab utne requests baaki nahi hain.`);
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('typing');
    const transcript = await transcribeTelegramAudio(ctx, ctx.message);
    addUsage(ctx, 'ai');
    if (isGroup(ctx) && chatSettings(ctx.chat.id).groupMemory !== false) {
      const key = memoryKey(ctx), history = pruneMemory(memoryFor(ctx));
      history.push({ role: 'user', text: transcript.slice(0, MAX_TEXT), createdAt: Date.now(), messageId: ctx.message.message_id, turnId: `voice-${ctx.message.message_id}`, speaker: ctx.from?.first_name || 'member' });
      state.memories[key] = pruneMemory(history); saveState();
    }
    const answer = await askGemini(ctx, `The user sent a voice message. Transcript (respond to its meaning; do not merely repeat it):\n${transcript}`, { remember: ctx.chat.type === 'private' || isGroup(ctx), memoryUserText: transcript });
    ctx.state.saayaReply = answer;
    await ctx.reply(answer, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true });
  } catch (err) {
    countError(ctx); console.error('Incoming voice processing failed:', err.message);
    await ctx.reply(`Voice note samajhne mein problem hui: ${err.message}`, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true });
  }
});

bot.command('joke', ctx => {
  const topic = getArg(ctx).slice(0, 500) || 'daily life';
  return runAICommand(ctx, `Tell one short, clever joke about ${topic}. Use the same language as the user's recent message.`, { remember: false });
});

bot.command('image', async ctx => {
  const prompt = getArg(ctx);
  if (!prompt) return ctx.reply('Use: /image <apna prompt>');
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('upload_photo');
    const image = await generateImage(prompt);
    await ctx.replyWithPhoto({ source: image.buffer, filename: `saaya-${Date.now()}.${image.mimeType.includes('jpeg') ? 'jpg' : 'png'}` }, { caption: `🖼️ Image generated for: ${prompt.slice(0, 700)}` });
  } catch (err) {
    countError(ctx);
    console.error('Image generation error:', err.message);
    await notifyOwnerError('Cloudflare image generation', ctx.chat.id);
    await ctx.reply('Image generate nahi ho paayi. Railway logs mein `Image generation error:` ke baad exact reason dekho.');
  }
});


bot.command('memory', async ctx => {
  if (ctx.chat.type !== 'private') return ctx.reply('Conversation memory sirf private DM mein available hai.');
  const val = getArg(ctx).toLowerCase();
  const prefs = userSettings(ctx.from.id);
  if (!['on', 'off'].includes(val)) return ctx.reply(`DM memory: ${prefs.memory === false ? 'off' : 'on'}. Use /memory on or /memory off. Clear saved history with /resetmemory.`);
  prefs.memory = val === 'on';
  if (val === 'off') delete state.memories[userKey(ctx)];
  saveState();
  await ctx.reply(val === 'off' ? 'Memory off; saved DM history bhi clear kar di.' : 'Memory on; DM conversation history is retained for 10 days. Use /memory off or /resetmemory to control it.');
});
bot.command('resetmemory', async ctx => {
  if (ctx.chat.type !== 'private') return ctx.reply('Memory controls sirf private DM mein available hain.');
  delete state.memories[userKey(ctx)];
  saveState();
  await ctx.reply('Tumhari saved DM conversation memory clear kar di.');
});

bot.command('groupmemory', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Group memory setting sirf group mein use hoti hai.');
  if (!await requireAdmin(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  const cfg = chatSettings(ctx.chat.id);
  if (!['on', 'off'].includes(value)) return ctx.reply(`Group memory: ${cfg.groupMemory ? 'on' : 'off'}. Use /groupmemory on|off. When enabled, Telegram-delivered group text/captions are kept for 10 days.`);
  cfg.groupMemory = value === 'on';
  saveState();
  await ctx.reply(value === 'on' ? 'Group conversation memory on; text/captions Telegram delivers to the bot are kept for 10 days.' : 'Group conversation memory off. Existing history remains until 10-day expiry; use /resetgroupmemory to clear it now.');
});
bot.command('resetgroupmemory', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Group memory controls sirf group mein available hain.');
  if (!await requireAdmin(ctx)) return;
  delete state.memories[`group:${ctx.chat.id}`];
  saveState();
  await ctx.reply('Is group ki saved conversation memory clear kar di.');
});
bot.command('memorysearch', async ctx => {
  if (isGroup(ctx) && !await requireAdmin(ctx)) return;
  const query = getArg(ctx).trim().toLowerCase();
  if (query.length < 2) return ctx.reply('Use /memorysearch <keyword> (kam-se-kam 2 characters).');
  const history = pruneMemory(state.memories[memoryKey(ctx)] || []);
  const hits = history.filter(e => String(e.text || '').toLowerCase().includes(query)).slice(-8).reverse();
  if (!hits.length) return ctx.reply(`Last 10 days ki memory mein “${query}” nahi mila.`);
  const lines = hits.map(e => {
    const date = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }).format(new Date(Number(e.createdAt) || Date.now()));
    const who = e.role === 'user' ? (e.speaker || 'User') : BOT_NAME;
    return `• ${date} — ${who}: ${String(e.text || '').slice(0, 240)}`;
  });
  await ctx.reply(`🔎 Memory matches for “${query}”\n${lines.join('\n')}`.slice(0, 3900));
});
bot.command('forget', async ctx => {
  if (isGroup(ctx) && !await requireAdmin(ctx)) return;
  const query = getArg(ctx).trim().toLowerCase();
  if (query.length < 2) return ctx.reply('Use /forget <keyword> (kam-se-kam 2 characters). Group mein admin-only.');
  const key = memoryKey(ctx), history = pruneMemory(state.memories[key] || []);
  const matchingTurns = new Set(history.filter(e => String(e.text || '').toLowerCase().includes(query)).map(e => e.turnId).filter(Boolean));
  const before = history.length;
  const kept = history.filter(e => !String(e.text || '').toLowerCase().includes(query) && !(e.turnId && matchingTurns.has(e.turnId)));
  state.memories[key] = kept;
  saveState();
  await ctx.reply(kept.length === before ? `“${query}” wali memory nahi mili.` : `“${query}” se match karne wali ${before - kept.length} memory entries hata di. Use /resetmemory or /resetgroupmemory to clear all.`);
});
bot.command('digest', async ctx => {
  if (isGroup(ctx) && !await requireAdmin(ctx)) return;
  if (isGroup(ctx) && chatSettings(ctx.chat.id).groupMemory === false) return ctx.reply('Group memory off hai; digest ke liye admin pehle /groupmemory on kare.');
  const range = (getArg(ctx).toLowerCase() || 'today');
  if (!['today', 'week'].includes(range)) return ctx.reply('Use /digest today or /digest week. Group mein admin-only.');
  const history = pruneMemory(state.memories[memoryKey(ctx)] || []);
  const now = Date.now();
  let start;
  if (range === 'week') start = now - 7 * 24 * 60 * 60 * 1000;
  else { const shifted = new Date(now + 330 * 60 * 1000); start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 330 * 60 * 1000; }
  const selected = history.filter(e => Number(e.createdAt) >= start).slice(-100);
  if (selected.length < 2) return ctx.reply(`Memory mein ${range} ka digest banane jitni conversation nahi hai.`);
  const transcript = selected.map(e => `${e.role === 'user' ? e.speaker || 'Member' : BOT_NAME}: ${String(e.text || '').slice(0, 320)}`).join('\n').slice(-3000);
  return runAICommand(ctx, `Write a clear, concise factual digest of this ${range} conversation. Capture decisions, tasks, unresolved questions, and important facts. Do not invent details, do not add owner name/handle unless present and relevant in the transcript, and do not turn the digest into a reply to the speaker.\nTranscript:\n${transcript}`, { remember: false });
});
bot.command('wishsettings', async ctx => {
  if (!isGroup(ctx)) return ctx.reply('Per-group wish settings sirf group mein available hain.');
  if (!await requireAdmin(ctx)) return;
  const cfg = chatSettings(ctx.chat.id), arg = getArg(ctx).trim();
  if (!arg) return ctx.reply(`Group wishes: times=${(cfg.wishTimes || WISH_SLOTS.map(s => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`)).join(',')}; language=${cfg.wishLanguage || 'Hindi/Hinglish'}. Use /wishsettings times 07:00,13:00,18:00,22:30 or /wishsettings language Hindi.`);
  const times = arg.match(/^times\s+(.+)$/i);
  const language = arg.match(/^language\s+([\s\S]+)$/i);
  if (/^reset$/i.test(arg)) { cfg.wishTimes = null; cfg.wishLanguage = ''; }
  else if (times) {
    const parts = times[1].split(',').map(x => x.trim());
    if (parts.length !== 4 || parts.some(x => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x)) || new Set(parts).size !== 4) return ctx.reply('4 unique times chahiye, format: /wishsettings times 07:00,13:00,18:00,22:30 (IST). Order: morning, afternoon, evening, night.');
    cfg.wishTimes = parts;
  } else if (language) {
    const requestedLanguage = language[1].trim();
    if (!/^[\p{L}\p{M}]+(?:[ -][\p{L}\p{M}]+)*$/u.test(requestedLanguage) || requestedLanguage.length > 40) return ctx.reply('Language ka naam simple text mein do, e.g. Hindi, English, Hinglish, Punjabi.');
    cfg.wishLanguage = requestedLanguage;
  } else return ctx.reply('Use /wishsettings times HH:MM,HH:MM,HH:MM,HH:MM; /wishsettings language Hindi; or /wishsettings reset.');
  saveState(); scheduleNextWish();
  await ctx.reply(`Group wish settings saved. Times: ${(cfg.wishTimes || WISH_SLOTS.map(s => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`)).join(',')} IST; language: ${cfg.wishLanguage || 'Hindi/Hinglish'}.`);
});
bot.command('wish', async ctx => {
  if (!['private', 'group', 'supergroup'].includes(ctx.chat.type)) return ctx.reply('Scheduled wishes sirf private chats aur groups ke liye hain.');
  if (isGroup(ctx) && !await ensureAdminCommand(ctx)) return;
  const value = getArg(ctx).toLowerCase();
  const recipient = state.wishRecipients[String(ctx.chat.id)] ||= { chatId: String(ctx.chat.id), type: ctx.chat.type, title: ctx.chat.title || '', enabled: true, createdAt: Date.now() };
  if (!['on', 'off'].includes(value)) {
    const cfg = isGroup(ctx) ? chatSettings(ctx.chat.id) : null;
    const times = cfg?.wishTimes || WISH_SLOTS.map(s => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`);
    return ctx.reply(`Scheduled wishes: ${recipient.enabled === false ? 'off' : 'on'} (${times.join(', ')} IST; ${cfg?.wishLanguage || 'Hindi/Hinglish'}). Use /wish on|off. Group times/language: /wishsettings; group admins control group wishes.`);
  }
  recipient.enabled = value === 'on';
  saveState(); scheduleNextWish();
  await ctx.reply(value === 'on' ? 'Scheduled shayari/photo wishes enabled for this chat.' : 'Scheduled wishes disabled for this chat.');
});

async function runAICommand(ctx, prompt, { remember = false } = {}) {
  if (!await allowRequest(ctx, 'ai')) return;
  addUsage(ctx, 'ai');
  try {
    await ctx.sendChatAction('typing');
    const cfg = isGroup(ctx) ? chatSettings(ctx.chat.id) : null;
    const groupContext = [];
    if (cfg?.rules) groupContext.push(`Admin-set rules for this group (follow them without changing the bot's core persona):\n${cfg.rules}`);
    if (cfg?.faq?.length) groupContext.push(`Verified group FAQ entries; use the matching answer when relevant and do not invent a different group-specific fact:\n${cfg.faq.slice(0, 20).map(item => `Q: ${item.question}\nA: ${item.answer}`).join('\n')}`);
    const contextBudget = Math.max(0, MAX_TEXT - prompt.length - 60);
    const groupContextText = groupContext.join('\n\n').slice(0, contextBudget);
    const contextualPrompt = groupContextText ? `${prompt}\n\n[Group context]\n${groupContextText}` : prompt;
    const reply = await askGemini(ctx, contextualPrompt, { remember, memoryUserText: prompt });
    ctx.state.saayaReply = reply;
    await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true });
  } catch (err) {
    countError(ctx);
    console.error('Gemini error:', err.message);
    await notifyOwnerError('Gemini reply', ctx.chat.id);
    await ctx.reply('Bamde reply dungi abhi time nhi hai mere pass.😐', { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true }).catch(() => {});
  }
}
bot.command('summarize', ctx => {
  const text = getArg(ctx) || ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
  if (!text) return ctx.reply('Kisi text message par reply karke /summarize bhejo, ya /summarize <text> likho.');
  return runAICommand(ctx, `Summarize this text in the same language. Keep the important points and be concise:\n${text}`, { remember: false });
});

bot.on('new_chat_members', async ctx => {
  if (!isGroup(ctx)) return;
  const cfg = chatSettings(ctx.chat.id);
  const newcomers = (ctx.message.new_chat_members || []).filter(member => member.id !== ctx.botInfo.id);
  if (cfg.verifyNewMembers) {
    for (const member of newcomers) await startMemberVerification(ctx, member);
    return;
  }
  if (!cfg.welcome || !newcomers.length) return;
  const names = newcomers.map(u => u.first_name).join(', ');
  const welcome = await generateWelcomeMessage(names, ctx.chat.title || '');
  await ctx.reply(welcome);
});
bot.action(/^sv:(\d+):([a-z0-9]+)$/i, async ctx => {
  const userId = ctx.match[1], nonce = ctx.match[2];
  if (String(ctx.from?.id) !== userId) return ctx.answerCbQuery('This verification button is for the new member.', { show_alert: true });
  const key = verificationKey(ctx.chat.id, userId);
  const pending = state.pendingVerifications[key];
  if (!pending || pending.nonce !== nonce || pending.expiresAt <= Date.now()) return ctx.answerCbQuery('This verification has expired.', { show_alert: true });
  try {
    await restoreMemberPermissions(ctx.chat.id, userId);
    delete state.pendingVerifications[key];
    clearTimeout(verificationTimers.get(key));
    verificationTimers.delete(key);
    saveState();
    await ctx.answerCbQuery('Verified! ✅');
    await ctx.editMessageText('✅ Verified — welcome to the group!');
  } catch (err) {
    console.error('Could not complete join verification:', err.message);
    await ctx.answerCbQuery('Could not verify. Please ask an admin for help.', { show_alert: true });
    await notifyOwnerError('Join verification completion', ctx.chat.id);
  }
});
bot.on('text', async (ctx, next) => {
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
  return runAICommand(ctx, text, { remember: ctx.chat.type === 'private' || isGroup(ctx) });
});

bot.catch(async (err, ctx) => {
  console.error(`Telegram update ${ctx.update?.update_id} failed:`, err.message);
  await notifyOwnerError('Telegram update handler', ctx?.chat?.id);
});

// Long polling: run a single Railway replica for each Telegram bot token.
bot.launch({ dropPendingUpdates: false }).then(() => {
  console.log(`${BOT_NAME} is running with Gemini (${GEMINI_MODEL}).`);
  for (const reminder of state.reminders) scheduleReminder(reminder);
  for (const pending of Object.values(state.pendingVerifications)) scheduleVerificationExpiry(pending);
  scheduleNextWish();
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ==========================================
// 🎵 Media Handler Setup (bot.launch se theek pehle)
// ==========================================
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; 
const setupMediaCommands = require('./mediaHandler.js');
setupMediaCommands(bot, YOUTUBE_API_KEY);

// ==========================================
// Tumhara Original Bot Launch Code
// ==========================================
bot.launch({ dropPendingUpdates: false }).then(() => {
  console.log(`${process.env.BOT_NAME || 'Bot'} is running.`);
  // Note: Agar tumhare code me state.reminders defined nahi hai, toh unhe comment kar dena
  if (typeof state !== 'undefined') {
      if (state.reminders) for (const reminder of state.reminders) scheduleReminder(reminder);
      if (state.pendingVerifications) for (const pending of Object.values(state.pendingVerifications)) scheduleVerificationExpiry(pending);
  }
  if (typeof scheduleNextWish === 'function') scheduleNextWish();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));


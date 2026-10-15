// mediaHandler.js
import axios from 'axios';
import ytdl from '@distube/ytdl-core';
import fs from 'node:fs';
import path from 'node:path';

export default function setupMediaCommands(bot, YOUTUBE_API_KEY) {
    let youtubeAgent;
    if (process.env.YOUTUBE_COOKIES) {
        try {
            const cookies = JSON.parse(process.env.YOUTUBE_COOKIES);
            youtubeAgent = ytdl.createAgent(cookies);
            console.log('YouTube cookies successfully loaded.');
        } catch (error) {
            console.error('YouTube cookies parse error:', error.message);
        }
    }

    const searchCache = new Map();
    const SEARCH_CACHE_TTL = 10 * 60 * 1000;

    function removeFile(filePath) {
        if (!filePath) return;
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Temporary file cleanup error:', error.message);
        }
    }

    function youtubeOptions(extra = {}) {
        return youtubeAgent ? { ...extra, agent: youtubeAgent } : extra;
    }

    async function searchYouTube(query, maxResults = 5) {
        if (!YOUTUBE_API_KEY) {
            console.error('YOUTUBE_API_KEY is missing.');
            return [];
        }

        try {
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${maxResults}&q=${encodeURIComponent(query)}&type=video&key=${YOUTUBE_API_KEY}`;
            const response = await axios.get(url, { timeout: 15000 });
            return (response.data?.items || []).filter(item => item?.id?.videoId);
        } catch (error) {
            console.error('YouTube API Error:', error.message);
            return [];
        }
    }

    function rememberSearch(results) {
        const key = Math.random().toString(36).slice(2, 10);
        searchCache.set(key, { results, expiresAt: Date.now() + SEARCH_CACHE_TTL });
        const timer = setTimeout(() => searchCache.delete(key), SEARCH_CACHE_TTL);
        timer.unref?.();
        return key;
    }

    function getSearch(key) {
        const item = searchCache.get(key);
        if (!item || item.expiresAt <= Date.now()) {
            searchCache.delete(key);
            return null;
        }
        return item.results;
    }

    function resultTitle(item) {
        return String(item?.snippet?.title || 'Untitled video').replace(/\s+/g, ' ').trim();
    }

    function resultUrl(item) {
        return `https://www.youtube.com/watch?v=${item.id.videoId}`;
    }

    function resultListText(results, kind) {
        const heading = kind === 'audio' ? '🎵 Top 5 songs' : '🎬 Top 5 videos';
        const lines = results.map((item, index) => {
            const channel = item.snippet?.channelTitle ? ` — ${item.snippet.channelTitle}` : '';
            return `${index + 1}. ${resultTitle(item)}${channel}`;
        });
        return `${heading}\n\n${lines.join('\n')}\n\nNeeche number dabakar selection bhejo:`;
    }

    function selectionKeyboard(key, kind, count) {
        return {
            inline_keyboard: [Array.from({ length: count }, (_, index) => ({
                text: String(index + 1),
                callback_data: `ytpick:${key}:${kind === 'audio' ? 'a' : 'v'}:${index}`
            }))]
        };
    }

    async function sendSearchResults(ctx, query, kind) {
        const statusMsg = await ctx.reply(`🔍 ${query} search kar raha hoon...`);
        const results = await searchYouTube(query, 5);

        if (!results.length) {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                '❌ Koi result nahi mila ya YouTube API mein problem hai.'
            ).catch(() => {});
            return;
        }

        const key = rememberSearch(results);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            resultListText(results, kind),
            { reply_markup: selectionKeyboard(key, kind, results.length) }
        ).catch(() => {});
    }

    async function downloadToFile(videoUrl, filePath, options) {
        const stream = ytdl(videoUrl, youtubeOptions(options));
        const output = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                error ? reject(error) : resolve();
            };
            stream.once('error', finish);
            output.once('error', finish);
            output.once('finish', () => finish());
            stream.pipe(output);
        });
    }

    async function sendAudio(ctx, videoUrl, statusMsg = null) {
        let filePath = null;
        try {
            const info = await ytdl.getInfo(videoUrl, youtubeAgent ? { agent: youtubeAgent } : undefined);
            const title = String(info.videoDetails?.title || 'YouTube Audio').slice(0, 180);
            const performer = String(info.videoDetails?.author?.name || 'YouTube').slice(0, 100);
            filePath = path.join('/tmp', `saaya-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

            if (statusMsg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `📥 ${title}\nAudio download ho raha hai...`
                ).catch(() => {});
            }

            await downloadToFile(videoUrl, filePath, { quality: 'highestaudio', filter: 'audioonly' });

            if (statusMsg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    '📤 Audio Telegram par upload ho raha hai...'
                ).catch(() => {});
            }

            await ctx.replyWithAudio({ source: filePath }, { title, performer });
            if (statusMsg) await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        } catch (error) {
            console.error('YouTube MP3 error:', error.message);
            const message = `❌ YouTube audio process nahi ho saka: ${error.message}`;
            if (statusMsg) {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, message).catch(() => {});
            } else {
                await ctx.reply(message).catch(() => {});
            }
        } finally {
            removeFile(filePath);
        }
    }

    async function sendVideo(ctx, videoUrl, statusMsg = null) {
        let filePath = null;
        try {
            const info = await ytdl.getInfo(videoUrl, youtubeAgent ? { agent: youtubeAgent } : undefined);
            const title = String(info.videoDetails?.title || 'YouTube Video').slice(0, 180);
            filePath = path.join('/tmp', `saaya-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

            if (statusMsg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `🎬 ${title}\n⏳ Video download ho raha hai...`
                ).catch(() => {});
            }

            await downloadToFile(videoUrl, filePath, { filter: 'videoandaudio', quality: 'highest' });
            const fileSizeInMB = fs.statSync(filePath).size / (1024 * 1024);
            if (fileSizeInMB > 50) {
                await ctx.reply(`⚠️ Video ${fileSizeInMB.toFixed(2)}MB ka hai. Telegram limit ke karan 50MB se badi video nahi bhej sakta.`);
            } else {
                await ctx.replyWithVideo({ source: filePath }, { caption: `🎬 ${title}` });
            }
            if (statusMsg) await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        } catch (error) {
            console.error('YouTube MP4 error:', error.message);
            const message = `❌ YouTube video process nahi ho saka: ${error.message}`;
            if (statusMsg) {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, message).catch(() => {});
            } else {
                await ctx.reply(message).catch(() => {});
            }
        } finally {
            removeFile(filePath);
        }
    }

    async function chooseResult(ctx, key, kind, index) {
        const results = getSearch(key);
        if (!results?.[index]) {
            await ctx.answerCbQuery('Yeh search list expire ho gayi hai. Dobara command bhejo.', { show_alert: true }).catch(() => {});
            return;
        }

        await ctx.answerCbQuery(`${Number(index) + 1} number selected.`).catch(() => {});
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
        const statusMsg = await ctx.reply(kind === 'audio' ? '⏳ Selected song process ho raha hai...' : '⏳ Selected video process ho raha hai...');
        const url = resultUrl(results[index]);
        if (kind === 'audio') await sendAudio(ctx, url, statusMsg);
        else await sendVideo(ctx, url, statusMsg);
    }

    bot.action(/^ytpick:([a-z0-9]+):([av]):([0-4])$/i, async ctx => {
        const [, key, mode, index] = ctx.match;
        return chooseResult(ctx, key, mode === 'a' ? 'audio' : 'video', Number(index));
    });

    bot.hears(/^\/mp3(?:@\w+)?(?:\s|$)/i, async ctx => {
        const query = String(ctx.message?.text || '').replace(/^\/mp3(?:@\w+)?/i, '').trim();
        if (!query) return ctx.reply('❌ Gaane ka naam likho. Jaise: /mp3 tum hi ho');
        if (ytdl.validateURL(query)) {
            const statusMsg = await ctx.reply('⏳ YouTube audio process ho raha hai...');
            return sendAudio(ctx, query, statusMsg);
        }
        return sendSearchResults(ctx, query, 'audio');
    });

    bot.hears(/^\/mp4(?:@\w+)?(?:\s|$)/i, async ctx => {
        const query = String(ctx.message?.text || '').replace(/^\/mp4(?:@\w+)?/i, '').trim();
        if (!query) return ctx.reply('❌ Video ka naam likho. Jaise: /mp4 funny cat');
        if (ytdl.validateURL(query)) {
            const statusMsg = await ctx.reply('⏳ YouTube video process ho raha hai...');
            return sendVideo(ctx, query, statusMsg);
        }
        return sendSearchResults(ctx, query, 'video');
    });

    bot.hears(/^\/play(?:@\w+)?(?:\s|$)/i, async ctx => {
        const query = String(ctx.message?.text || '').replace(/^\/play(?:@\w+)?/i, '').trim();
        if (!query) return ctx.reply('❌ Gaane ka naam likho. Jaise: /play kesariya');
        if (ytdl.validateURL(query)) {
            const statusMsg = await ctx.reply('⏳ YouTube audio process ho raha hai...');
            return sendAudio(ctx, query, statusMsg);
        }

        const statusMsg = await ctx.reply(`🔍 ${query} ka top result search kar raha hoon...`);
        const results = await searchYouTube(query, 5);
        if (!results.length) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                '❌ Gaana nahi mila ya YouTube API mein problem hai.'
            ).catch(() => {});
        }
        return sendAudio(ctx, resultUrl(results[0]), statusMsg);
    });

    // Direct YouTube URL -> MP3 feature. This does not use YouTube API search.
    async function handleYouTubeUrl(ctx, text) {
        const videoUrl = String(text || '').trim();
        if (!ytdl.validateURL(videoUrl)) return false;
        const statusMsg = await ctx.reply('⏳ YouTube audio process ho raha hai...');
        await sendAudio(ctx, videoUrl, statusMsg);
        return true;
    }

    return { handleYouTubeUrl };
}

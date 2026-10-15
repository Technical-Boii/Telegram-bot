// mediaHandler.js
import axios from 'axios';
import YTDlpWrapModule from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs';
import path from 'node:path';

export default function setupMediaCommands(bot, YOUTUBE_API_KEY) {
    const searchCache = new Map();
    const SEARCH_CACHE_TTL = 10 * 60 * 1000;
    const cookieFilePath = path.join('/tmp', `saaya-youtube-cookies-${process.pid}.txt`);
    const ytDlpBinary = path.resolve(process.env.YTDLP_BINARY_PATH || './bin/yt-dlp');
    const ytDlpWrap = new YTDlpWrap(ytDlpBinary);
    const ytDlpRequestDelayMs = Math.max(1000, Number(process.env.YTDLP_REQUEST_DELAY_MS || 2500));
    let ytDlpQueue = Promise.resolve();
    let lastYtDlpRequestAt = 0;

    function removeFile(filePath) {
        if (!filePath) return;
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Temporary file cleanup error:', error.message);
        }
    }

    function prepareCookies() {
        const raw = String(process.env.YOUTUBE_COOKIES || '').trim();
        if (!raw) return null;

        try {
            if (raw.startsWith('# Netscape HTTP Cookie File')) {
                fs.writeFileSync(cookieFilePath, raw, { mode: 0o600 });
                console.log('YouTube cookies successfully loaded.');
                return cookieFilePath;
            }

            const parsed = JSON.parse(raw);
            const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
            if (!Array.isArray(cookies) || !cookies.length) throw new Error('Cookie JSON must be an array.');

            const lines = [
                '# Netscape HTTP Cookie File',
                '# This file is generated from YOUTUBE_COOKIES.',
                ''
            ];
            for (const cookie of cookies) {
                if (!cookie?.name || cookie.value == null) continue;
                const domain = String(cookie.domain || cookie.host || '.youtube.com');
                const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE';
                const cookiePath = String(cookie.path || '/');
                const secure = cookie.secure ? 'TRUE' : 'FALSE';
                const expires = cookie.session
                    ? 0
                    : Math.floor(Number(cookie.expirationDate || cookie.expires || 0));
                lines.push([
                    domain,
                    includeSubdomains,
                    cookiePath,
                    secure,
                    Number.isFinite(expires) ? expires : 0,
                    String(cookie.name),
                    String(cookie.value)
                ].join('\t'));
            }

            if (lines.length <= 3) throw new Error('No usable cookies found.');
            fs.writeFileSync(cookieFilePath, `${lines.join('\n')}\n`, { mode: 0o600 });
            console.log('YouTube cookies successfully loaded.');
            return cookieFilePath;
        } catch (error) {
            console.error('YouTube cookies parse error:', error.message);
            removeFile(cookieFilePath);
            return null;
        }
    }

    const cookieFile = prepareCookies();

    function ytDlpBaseArgs(includeCookies = true) {
        const args = [
            '--no-warnings',
            '--no-playlist',
            '--retries', '2',
            '--socket-timeout', '30'
        ];
        if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
        if (includeCookies && cookieFile) args.push('--cookies', cookieFile);
        return args;
    }

    function isYouTubeUrl(value) {
        try {
            const url = new URL(String(value || '').trim());
            return /(^|\.)youtube\.com$/i.test(url.hostname) || url.hostname === 'youtu.be';
        } catch {
            return false;
        }
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

    function canRetryWithAlternateClient(error) {
        const message = String(error?.message || error || '');
        return /page needs to be reloaded|playable formats|requested format is not available|po token|http error 403|http error 429|unable to download video data/i.test(message);
    }

    async function runYtDlp(videoUrl, args = []) {
        const attempts = [{ args, includeCookies: Boolean(cookieFile), label: 'default client with cookies' }];
        if (!args.includes('--extractor-args')) {
            attempts.push({ args: [...args, '--extractor-args', 'youtube:player_client=web_safari'], includeCookies: Boolean(cookieFile), label: 'web_safari client with cookies' });
            if (cookieFile) {
                attempts.push({ args, includeCookies: false, label: 'default client without cookies' });
                attempts.push({ args: [...args, '--extractor-args', 'youtube:player_client=web_safari'], includeCookies: false, label: 'web_safari client without cookies' });
            }
        }

        let lastError;
        for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
            const attempt = attempts[attemptIndex];
            try {
                const run = async () => {
                    const elapsed = Date.now() - lastYtDlpRequestAt;
                    if (elapsed < ytDlpRequestDelayMs) {
                        await new Promise(resolve => setTimeout(resolve, ytDlpRequestDelayMs - elapsed));
                    }
                    lastYtDlpRequestAt = Date.now();
                    const output = await ytDlpWrap.execPromise([
                        ...ytDlpBaseArgs(attempt.includeCookies),
                        ...attempt.args,
                        videoUrl
                    ]);
                    return typeof output === 'string' ? output : String(output?.stdout || '');
                };
                const result = ytDlpQueue.then(run, run);
                ytDlpQueue = result.catch(() => {});
                return await result;
            } catch (error) {
                lastError = error;
                const message = String(error?.message || error || '');
                const cookieAuthBlocked = /sign in to confirm|not a bot|use --cookies/i.test(message);
                if (cookieAuthBlocked && attempt.includeCookies) {
                    const noCookieIndex = attempts.findIndex((candidate, index) => index > attemptIndex && !candidate.includeCookies);
                    if (noCookieIndex >= 0) {
                        attemptIndex = noCookieIndex - 1;
                        console.log('yt-dlp cookies were rejected; trying one public-video request without cookies.');
                        continue;
                    }
                }
                const canContinue = attemptIndex < attempts.length - 1 && canRetryWithAlternateClient(error);
                if (!canContinue) throw error;
                console.log(`yt-dlp ${attempt.label} failed; trying next fallback.`);
            }
        }
        throw lastError;
    }

    async function getVideoInfo(videoUrl) {
        const output = await runYtDlp(videoUrl, ['--dump-single-json', '--skip-download']);
        const jsonStart = output.indexOf('{');
        if (jsonStart < 0) throw new Error('yt-dlp metadata nahi de saka.');
        return JSON.parse(output.slice(jsonStart));
    }

    async function downloadToFile(videoUrl, filePath, args = []) {
        await runYtDlp(videoUrl, [
            '--output', filePath,
            '--force-overwrites',
            '--no-part',
            ...args
        ]);
        if (!fs.existsSync(filePath)) throw new Error('yt-dlp ne output file create nahi ki.');
    }

    async function sendAudio(ctx, videoUrl, statusMsg = null) {
        let filePath = null;
        try {
            const info = await getVideoInfo(videoUrl);
            const title = String(info?.title || 'YouTube Audio').slice(0, 180);
            const performer = String(info?.uploader || info?.channel || 'YouTube').slice(0, 100);
            filePath = path.join('/tmp', `saaya-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

            if (statusMsg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `📥 ${title}\nAudio download ho raha hai...`
                ).catch(() => {});
            }

            await downloadToFile(videoUrl, filePath, [
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '0'
            ]);

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
            const info = await getVideoInfo(videoUrl);
            const title = String(info?.title || 'YouTube Video').slice(0, 180);
            filePath = path.join('/tmp', `saaya-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

            if (statusMsg) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `🎬 ${title}\n⏳ Video download ho raha hai...`
                ).catch(() => {});
            }

            await downloadToFile(videoUrl, filePath, [
                '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '--merge-output-format', 'mp4'
            ]);
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
        if (isYouTubeUrl(query)) {
            const statusMsg = await ctx.reply('⏳ YouTube audio process ho raha hai...');
            return sendAudio(ctx, query, statusMsg);
        }
        return sendSearchResults(ctx, query, 'audio');
    });

    bot.hears(/^\/mp4(?:@\w+)?(?:\s|$)/i, async ctx => {
        const query = String(ctx.message?.text || '').replace(/^\/mp4(?:@\w+)?/i, '').trim();
        if (!query) return ctx.reply('❌ Video ka naam likho. Jaise: /mp4 funny cat');
        if (isYouTubeUrl(query)) {
            const statusMsg = await ctx.reply('⏳ YouTube video process ho raha hai...');
            return sendVideo(ctx, query, statusMsg);
        }
        return sendSearchResults(ctx, query, 'video');
    });

    bot.hears(/^\/play(?:@\w+)?(?:\s|$)/i, async ctx => {
        const query = String(ctx.message?.text || '').replace(/^\/play(?:@\w+)?/i, '').trim();
        if (!query) return ctx.reply('❌ Gaane ka naam likho. Jaise: /play kesariya');
        if (isYouTubeUrl(query)) {
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

    async function handleYouTubeUrl(ctx, text) {
        const videoUrl = String(text || '').trim();
        if (!isYouTubeUrl(videoUrl)) return false;
        const statusMsg = await ctx.reply('⏳ YouTube audio process ho raha hai...');
        await sendAudio(ctx, videoUrl, statusMsg);
        return true;
    }

    process.once('exit', () => removeFile(cookieFile));
    return { handleYouTubeUrl };
}

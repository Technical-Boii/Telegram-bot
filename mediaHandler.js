// mediaHandler.js
import axios from 'axios';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';

export default function setupMediaCommands(bot, YOUTUBE_API_KEY) {
    // YouTube API Search Function
    async function searchYouTube(query) {
        try {
            if (!YOUTUBE_API_KEY) {
                console.error('YOUTUBE_API_KEY is missing.');
                return null;
            }

            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&key=${YOUTUBE_API_KEY}`;
            const response = await axios.get(url, { timeout: 15000 });

            if (response.data.items && response.data.items.length > 0) {
                return response.data.items[0];
            }

            return null;
        } catch (error) {
            console.error('YouTube API Error:', error.message);
            return null;
        }
    }

    function removeFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.error('Temporary file cleanup error:', error.message);
        }
    }

    // 🎵 /mp3 Command
    bot.command('mp3', async (ctx) => {
        const query = String(ctx.message?.text || '')
            .replace(/^\/mp3(?:@\w+)?/i, '')
            .trim();

        if (!query) {
            return ctx.reply(
                '❌ Kripya gaane ka naam bhi likhein. Jaise: /mp3 rafta rafta sanam'
            );
        }

        const statusMsg = await ctx.reply(
            `🔍 *${query}* search kar raha hoon...`,
            { parse_mode: 'Markdown' }
        );

        const video = await searchYouTube(query);
        if (!video?.id?.videoId) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                '❌ Gaana nahi mila ya YouTube API me problem hai.'
            ).catch(() => {});
        }

        const videoId = video.id.videoId;
        const title = video.snippet?.title || query;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}-${Date.now()}.mp3`);

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎵 *${title}*\n⏳ MP3 Download ho raha hai...`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        try {
            const stream = ytdl(videoUrl, {
                filter: 'audioonly',
                quality: 'highestaudio'
            });

            const output = fs.createWriteStream(filePath);
            let finished = false;

            stream.on('error', async (error) => {
                console.error('YouTube MP3 download error:', error);
                removeFile(filePath);

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `❌ MP3 download nahi ho saka: ${error.message}`
                ).catch(() => {});
            });

            output.on('error', async (error) => {
                console.error('MP3 file write error:', error);
                removeFile(filePath);

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `❌ Audio file save nahi ho saki: ${error.message}`
                ).catch(() => {});
            });

            output.on('finish', async () => {
                if (finished) return;
                finished = true;

                try {
                    await ctx.replyWithAudio(
                        { source: filePath },
                        {
                            title,
                            performer: 'Saaya Bot'
                        }
                    );

                    await ctx.telegram.deleteMessage(
                        ctx.chat.id,
                        statusMsg.message_id
                    ).catch(() => {});
                } catch (error) {
                    console.error('Telegram audio upload error:', error);
                    await ctx.reply(
                        `❌ Audio Telegram par bhejne me problem: ${error.message}`
                    ).catch(() => {});
                } finally {
                    removeFile(filePath);
                }
            });

            stream.pipe(output);
        } catch (error) {
            console.error('MP3 setup error:', error);
            removeFile(filePath);

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `❌ MP3 download error: ${error.message}`
            ).catch(() => {});
        }
    });

    // 🎬 /mp4 Command
    bot.command('mp4', async (ctx) => {
        const query = String(ctx.message?.text || '')
            .replace(/^\/mp4(?:@\w+)?/i, '')
            .trim();

        if (!query) {
            return ctx.reply(
                '❌ Kripya video ka naam bhi likhein. Jaise: /mp4 funny cat'
            );
        }

        const statusMsg = await ctx.reply(
            `🔍 *${query}* video search kar raha hoon...`,
            { parse_mode: 'Markdown' }
        );

        const video = await searchYouTube(query);
        if (!video?.id?.videoId) {
            return ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                '❌ Video nahi mila ya YouTube API me problem hai.'
            ).catch(() => {});
        }

        const videoId = video.id.videoId;
        const title = video.snippet?.title || query;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}-${Date.now()}.mp4`);

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎬 *${title}*\n⏳ Video Download ho raha hai (Isme time lag sakta hai)...`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        try {
            const stream = ytdl(videoUrl, {
                filter: 'videoandaudio',
                quality: 'highest'
            });

            const output = fs.createWriteStream(filePath);
            let finished = false;

            stream.on('error', async (error) => {
                console.error('YouTube MP4 download error:', error);
                removeFile(filePath);

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `❌ Video download nahi ho saka: ${error.message}`
                ).catch(() => {});
            });

            output.on('error', async (error) => {
                console.error('MP4 file write error:', error);
                removeFile(filePath);

                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    `❌ Video file save nahi ho saki: ${error.message}`
                ).catch(() => {});
            });

            output.on('finish', async () => {
                if (finished) return;
                finished = true;

                try {
                    const stats = fs.statSync(filePath);
                    const fileSizeInMB = stats.size / (1024 * 1024);

                    if (fileSizeInMB > 50) {
                        await ctx.reply(
                            `⚠️ *Sorry!* Video ka size ${fileSizeInMB.toFixed(2)}MB hai. Telegram limits ke karan main sirf 50MB tak bhej sakta hoon.`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await ctx.replyWithVideo(
                            { source: filePath },
                            { caption: `🎬 ${title}` }
                        );
                    }
                } catch (error) {
                    console.error('Telegram video upload error:', error);
                    await ctx.reply(
                        `❌ Video Telegram par bhejne me problem: ${error.message}`
                    ).catch(() => {});
                } finally {
                    removeFile(filePath);
                    await ctx.telegram.deleteMessage(
                        ctx.chat.id,
                        statusMsg.message_id
                    ).catch(() => {});
                }
            });

            stream.pipe(output);
        } catch (error) {
            console.error('MP4 setup error:', error);
            removeFile(filePath);

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `❌ Video download error: ${error.message}`
            ).catch(() => {});
        }
    });
}

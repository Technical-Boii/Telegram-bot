// mediaHandler.js ka naya ESM code
import axios from 'axios';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';

export default function setupMediaCommands(bot, YOUTUBE_API_KEY) {

    // YouTube API Search Function
    async function searchYouTube(query) {
        try {
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&key=${YOUTUBE_API_KEY}`;
            const response = await axios.get(url);
            if (response.data.items && response.data.items.length > 0) {
                return response.data.items[0];
            }
            return null;
        } catch (error) {
            console.error("YouTube API Error:", error.message);
            return null;
        }
    }

    // 🎵 /mp3 Command
    bot.command('mp3', async (ctx) => {
        const query = ctx.message.text.replace('/mp3', '').trim();
        if (!query) return ctx.reply("❌ Kripya gaane ka naam bhi likhein. Jaise: /mp3 rafta rafta sanam");

        const statusMsg = await ctx.reply(`🔍 *${query}* search kar raha hoon...`, { parse_mode: 'Markdown' });

        const video = await searchYouTube(query);
        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "❌ Gaana nahi mila ya API me problem hai.");
        }

        const videoId = video.id.videoId;
        const title = video.snippet.title;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}.mp3`); 

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🎵 *${title}*\n⏳ MP3 Download ho raha hai...`, { parse_mode: 'Markdown' });

        await ctx.telegram.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    undefined,
    `🎵 *${title}*\n⏳ MP3 Download ho raha hai...`,
    { parse_mode: 'Markdown' }
);

// YAHAN se naya code paste karein
try {
    const stream = ytdl(videoUrl, {
        filter: 'audioonly',
        quality: 'highestaudio'
    });

    const output = fs.createWriteStream(filePath);

    stream.on('error', async (err) => {
        console.error('YouTube download error:', err);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `❌ MP3 download nahi ho saka: ${err.message}`
        ).catch(() => {});
    });

    output.on('error', async (err) => {
        console.error('File write error:', err);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `❌ Audio file save nahi ho saki: ${err.message}`
        ).catch(() => {});
    });

    output.on('finish', async () => {
        try {
            await ctx.replyWithAudio(
                { source: filePath },
                {
                    title: title,
                    performer: 'Saaya Bot'
                }
            );

            await ctx.telegram.deleteMessage(
                ctx.chat.id,
                statusMsg.message_id
            ).catch(() => {});
        } catch (err) {
            console.error('Telegram audio upload error:', err);
            await ctx.reply(
                `❌ Audio Telegram par bhejne me problem: ${err.message}`
            );
        } finally {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    });

    stream.pipe(output);

} catch (error) {
    console.error('MP3 setup error:', error);

    await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `❌ MP3 download error: ${error.message}`
    ).catch(() => {});
}

    // 🎬 /mp4 Command
    bot.command('mp4', async (ctx) => {
        const query = ctx.message.text.replace('/mp4', '').trim();
        if (!query) return ctx.reply("❌ Kripya video ka naam likhein. Jaise: /mp4 funny cat");

        const statusMsg = await ctx.reply(`🔍 *${query}* video search kar raha hoon...`, { parse_mode: 'Markdown' });

        const video = await searchYouTube(query);
        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "❌ Video nahi mila.");
        }

        const videoId = video.id.videoId;
        const title = video.snippet.title;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}.mp4`);

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🎬 *${title}*\n⏳ Video Download ho raha hai (Isme time lag sakta hai)...`, { parse_mode: 'Markdown' });

        try {
            const stream = ytdl(videoUrl, { filter: 'videoandaudio', quality: 'highest' });
            stream.pipe(fs.createWriteStream(filePath))
                .on('finish', async () => {
                    try {
                        const stats = fs.statSync(filePath);
                        const fileSizeInMB = stats.size / (1024 * 1024);

                        if (fileSizeInMB > 50) {
                            await ctx.reply(`⚠️ *Sorry!* Video ka size ${fileSizeInMB.toFixed(2)}MB hai. Telegram limits ke karan main sirf 50MB tak bhej sakta hoon.`, { parse_mode: 'Markdown' });
                        } else {
                            await ctx.replyWithVideo({ source: filePath }, { caption: `🎬 ${title}` });
                        }
                    } catch (uploadErr) {
                        ctx.reply(`❌ Bhejne me problem: ${uploadErr.message}`);
                    } finally {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
                    }
                })
                .on('error', (err) => {
                    ctx.reply(`❌ Download error: ${err.message}`);
                });
        } catch (error) {
            ctx.reply(`❌ Error: ${error.message}`);
        }
    });
}

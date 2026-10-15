const axios = require('axios');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');

// Yeh function humari main file (index.js) me export hoga
module.exports = function(bot, YOUTUBE_API_KEY) {

    // YouTube V3 API se video search karne ka function
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

    // ==========================================
    // 🎵 /mp3 Command Handler
    // ==========================================
    bot.onText(/\/mp3 (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const query = match[1]; // User ne jo gaane ka naam likha hai

        const statusMsg = await bot.sendMessage(chatId, `🔍 *${query}* search kar raha hoon...`, {parse_mode: 'Markdown'});

        const video = await searchYouTube(query);
        if (!video) {
            return bot.editMessageText("❌ Gaana nahi mila ya YouTube API me koi dikkat hai.", { chat_id: chatId, message_id: statusMsg.message_id });
        }

        const videoId = video.id.videoId;
        const title = video.snippet.title;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}.mp3`); // Railway me /tmp folder safe hota hai

        await bot.editMessageText(`🎵 *${title}*\n⏳ MP3 Download ho raha hai, kripya thoda wait karein...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });

        try {
            const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
            stream.pipe(fs.createWriteStream(filePath))
                .on('finish', async () => {
                    // Download complete hone par Telegram me bhejna
                    await bot.sendAudio(chatId, fs.createReadStream(filePath), { title: title, performer: "Saaya Bot" });
                    
                    // Bhejne ke baad Railway ki storage khali karna (Zaruri hai!)
                    fs.unlinkSync(filePath);
                    bot.deleteMessage(chatId, statusMsg.message_id);
                })
                .on('error', (err) => {
                    bot.sendMessage(chatId, `❌ Download fail ho gaya: ${err.message}`);
                });
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // ==========================================
    // 🎬 /mp4 Command Handler
    // ==========================================
    bot.onText(/\/mp4 (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const query = match[1]; 

        const statusMsg = await bot.sendMessage(chatId, `🔍 *${query}* video search kar raha hoon...`, {parse_mode: 'Markdown'});

        const video = await searchYouTube(query);
        if (!video) {
            return bot.editMessageText("❌ Video nahi mila.", { chat_id: chatId, message_id: statusMsg.message_id });
        }

        const videoId = video.id.videoId;
        const title = video.snippet.title;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const filePath = path.join('/tmp', `${videoId}.mp4`);

        await bot.editMessageText(`🎬 *${title}*\n⏳ Video Download ho raha hai (Isme thoda time lag sakta hai)...`, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });

        try {
            // Video and Audio format dono chahiye
            const stream = ytdl(videoUrl, { filter: 'videoandaudio', quality: 'highest' });
            stream.pipe(fs.createWriteStream(filePath))
                .on('finish', async () => {
                    try {
                        // File size check karna (50MB Limit ke liye)
                        const stats = fs.statSync(filePath);
                        const fileSizeInMB = stats.size / (1024 * 1024);

                        if (fileSizeInMB > 50) {
                            await bot.sendMessage(chatId, `⚠️ *Sorry!* Video ka size ${fileSizeInMB.toFixed(2)}MB hai. Telegram standard bots se sirf 50MB tak ki files bhej sakte hain.`, {parse_mode: 'Markdown'});
                        } else {
                            await bot.sendVideo(chatId, fs.createReadStream(filePath), { caption: `🎬 ${title}` });
                        }
                    } catch (uploadErr) {
                        bot.sendMessage(chatId, `❌ Bhejne me problem aayi: ${uploadErr.message}`);
                    } finally {
                        // Har haal me file delete karni hai taaki server ka space na bhare
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        bot.deleteMessage(chatId, statusMsg.message_id);
                    }
                })
                .on('error', (err) => {
                    bot.sendMessage(chatId, `❌ Video download fail: ${err.message}`);
                });
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });
};


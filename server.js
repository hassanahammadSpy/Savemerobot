const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

// টেলিগ্রাম বট তৈরি
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ব্যবহারকারীর ইউআরএল সাময়িকভাবে জমা রাখার জন্য
const userRequests = {};

// ভিডিও ডাটা নিয়ে আসার ফাংশন
async function fetchVideoData(videoUrl) {
    try {
        const apiUrl = `https://r-gengpt-api.vercel.app/api/video/download?url=${encodeURIComponent(videoUrl)}`;
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) {
        return null;
    }
}

// লিঙ্ক মেসেজ হ্যান্ডলার
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const text = msg.text;

    if (text && text.startsWith('http')) {
        // ১. লিঙ্ক পাওয়ার পর রিঅ্যাকশন দেওয়া (👀)
        try {
            await bot.setMessageReaction(chatId, messageId, {
                reaction: [{ type: 'emoji', emoji: '👀' }]
            });
        } catch (e) {
            console.log("Reaction error:", e.message);
        }

        // ইউআরএলটি সেভ করে রাখা
        userRequests[chatId] = text;

        // ২. অপশন সিলেক্ট করতে বলা (Inline Buttons)
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🎥 Video (MP4)", callback_data: 'type_video' },
                        { text: "🎵 Audio (MP3)", callback_data: 'type_audio' }
                    ]
                ]
            }
        };
        bot.sendMessage(chatId, "Select your download format:", opts);
    } else if (text === '/start') {
        bot.sendMessage(chatId, "Welcome! Send me a video link to start.");
    }
});

// বাটন ক্লিক হ্যান্ডলার (Callback Query)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const choice = query.data;
    const videoUrl = userRequests[chatId];

    if (!videoUrl) {
        return bot.sendMessage(chatId, "❌ Session expired. Please send the link again.");
    }

    // মেসেজটি এডিট করে লোডিং দেখানো
    bot.editMessageText("⏳ Processing your request...", {
        chat_id: chatId,
        message_id: query.message.message_id
    });

    const result = await fetchVideoData(videoUrl);

    if (result && result.data && result.data.medias) {
        const medias = result.data.medias;
        let selectedFile = null;

        if (choice === 'type_video') {
            // ভিডিও ফাইল খোঁজা
            selectedFile = medias.find(m => m.type === 'video' || m.extension === 'mp4');
        } else if (choice === 'type_audio') {
            // অডিও বা মিউজিক ফাইল খোঁজা
            selectedFile = medias.find(m => m.type === 'audio' || m.extension === 'mp3' || m.quality.includes('kbps'));
        }

        if (selectedFile) {
            try {
                if (choice === 'type_video') {
                    await bot.sendVideo(chatId, selectedFile.url, { caption: `✅ **${result.data.title}**` });
                } else {
                    await bot.sendAudio(chatId, selectedFile.url, { title: result.data.title });
                }
                // সফল হলে সেশন ডিলিট করা
                delete userRequests[chatId];
            } catch (err) {
                bot.sendMessage(chatId, `❌ Direct send failed. Download here: ${selectedFile.url}`);
            }
        } else {
            bot.sendMessage(chatId, "❌ Sorry, requested format not found for this link.");
        }
    } else {
        bot.sendMessage(chatId, "❌ Failed to fetch video data.");
    }
});

// API for Website
app.get('/api/download', async (req, res) => {
    const url = req.query.url;
    const data = await fetchVideoData(url);
    res.json(data);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 7767338426;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ইন-মেমোরি ডাটাবেস (সার্ভার রিস্টার্ট হলে এগুলো রিসেট হবে)
let db = {
    users: new Set(),
    totalDownloads: 0,
    channels: [] // উদাহরণ: ["@yourchannel"]
};

const userRequests = {};
const adminState = {}; // এডমিনের ইনপুট ট্র্যাক করার জন্য

// ভিডিও ডাটা ফেচ ফাংশন
async function fetchVideoData(videoUrl) {
    try {
        const apiUrl = `https://r-gengpt-api.vercel.app/api/video/download?url=${encodeURIComponent(videoUrl)}`;
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) { return null; }
}

// সাবস্ক্রিপশন চেক ফাংশন
async function isSubscribed(userId) {
    if (db.channels.length === 0) return true;
    for (const channel of db.channels) {
        try {
            const res = await bot.getChatMember(channel, userId);
            const status = res.status;
            if (status === 'left' || status === 'kicked') return false;
        } catch (e) {
            console.log("Channel Check Error:", e.message);
            return false;
        }
    }
    return true;
}

// মেসেজ হ্যান্ডলার
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ইউজার ট্র্যাক করা
    db.users.add(chatId);

    if (!text) return;

    // ১. এডমিন প্যানেল কমান্ড
    if (text === '/adminpanel' && chatId === ADMIN_ID) {
        const statsMsg = `🛠 **Admin Panel**\n\n` +
            `👥 Total Users: ${db.users.size}\n` +
            `📥 Total Downloads: ${db.totalDownloads}\n` +
            `📢 Active Channels: ${db.channels.length > 0 ? db.channels.join(', ') : 'None'}`;
        
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "➕ Add Channel", callback_data: 'admin_add_ch' },
                        { text: "❌ Remove Channel", callback_data: 'admin_rem_ch' }
                    ]
                ]
            }
        };
        return bot.sendMessage(chatId, statsMsg, opts);
    }

    // ২. এডমিন ইনপুট হ্যান্ডলিং (চ্যানেল এড/রিমুভ)
    if (adminState[chatId] === 'awaiting_add') {
        if (text.startsWith('@')) {
            db.channels.push(text);
            adminState[chatId] = null;
            return bot.sendMessage(chatId, `✅ Channel ${text} added!`);
        } else {
            return bot.sendMessage(chatId, "❌ Please send username starting with @");
        }
    }
    
    if (adminState[chatId] === 'awaiting_rem') {
        db.channels = db.channels.filter(c => c !== text);
        adminState[chatId] = null;
        return bot.sendMessage(chatId, `✅ Channel ${text} removed!`);
    }

    // ৩. ভিডিও লিঙ্ক হ্যান্ডলিং
    if (text.startsWith('http')) {
        // সাবস্ক্রিপশন চেক
        const subscribed = await isSubscribed(chatId);
        if (!subscribed) {
            const chLinks = db.channels.map(c => `👉 [Join Channel](https://t.me/${c.replace('@','')})`).join('\n');
            return bot.sendMessage(chatId, `⚠️ **Access Denied!**\nYou must join our channels first to use this bot:\n\n${chLinks}\n\nAfter joining, send the link again.`, { parse_mode: 'Markdown' });
        }

        // রিঅ্যাকশন দেওয়া 👀
        try {
            await bot.setMessageReaction(chatId, msg.message_id, {
                reaction: [{ type: 'emoji', emoji: '👀' }]
            });
        } catch (e) {}

        userRequests[chatId] = text;
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎥 Video (MP4)", callback_data: 'type_video' },
                     { text: "🎵 Audio (MP3)", callback_data: 'type_audio' }]
                ]
            }
        };
        bot.sendMessage(chatId, "Select format:", opts);
    }

    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome! Send a video link to download.");
    }
});

// বাটন হ্যান্ডলার
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // এডমিন বাটন অ্যাকশন
    if (data === 'admin_add_ch') {
        adminState[chatId] = 'awaiting_add';
        return bot.sendMessage(chatId, "Please send the channel username (e.g., @mychannel):");
    }
    if (data === 'admin_rem_ch') {
        adminState[chatId] = 'awaiting_rem';
        return bot.sendMessage(chatId, "Send the channel username to remove (e.g., @mychannel):");
    }

    // ডাউনলোড বাটন অ্যাকশন
    const videoUrl = userRequests[chatId];
    if (!videoUrl) return bot.answerCallbackQuery(query.id, { text: "Link expired!" });

    bot.answerCallbackQuery(query.id, { text: "Processing..." });
    const result = await fetchVideoData(videoUrl);

    if (result && result.data && result.data.medias) {
        let file = null;
        if (data === 'type_video') file = result.data.medias.find(m => m.type === 'video');
        else file = result.data.medias.find(m => m.type === 'audio' || m.extension === 'mp3');

        if (file) {
            try {
                if (data === 'type_video') await bot.sendVideo(chatId, file.url);
                else await bot.sendAudio(chatId, file.url);
                
                db.totalDownloads++; // ডাউনলোড কাউন্ট বাড়ানো
                delete userRequests[chatId];
            } catch (e) {
                bot.sendMessage(chatId, `Error sending file. Link: ${file.url}`);
            }
        }
    }
});

// API for Website
app.get('/api/download', async (req, res) => {
    const url = req.query.url;
    const data = await fetchVideoData(url);
    res.json(data);
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

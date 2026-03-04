const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 7767338426;

// Firebase Initialization
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userRequests = {};
const adminState = {};

// API Function
async function fetchVideoData(videoUrl) {
    try {
        const apiUrl = `https://r-gengpt-api.vercel.app/api/video/download?url=${encodeURIComponent(videoUrl)}`;
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) { return null; }
}

// Force Join Check
async function isSubscribed(userId) {
    const snapshot = await db.ref('channels').once('value');
    const channels = snapshot.val() || [];
    if (channels.length === 0) return true;

    for (const channel of channels) {
        try {
            const res = await bot.getChatMember(channel, userId);
            if (['left', 'kicked'].includes(res.status)) return false;
        } catch (e) { return false; }
    }
    return true;
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Save User to Firebase
    db.ref(`users/${chatId}`).set(true);

    if (text === '/adminpanel' && chatId === ADMIN_ID) {
        const userSnap = await db.ref('users').once('value');
        const statsSnap = await db.ref('totalDownloads').once('value');
        const chanSnap = await db.ref('channels').once('value');

        const totalUsers = userSnap.numChildren() || 0;
        const totalDl = statsSnap.val() || 0;
        const channels = chanSnap.val() || [];

        const statsMsg = `🛠 **Admin Panel**\n\n👥 Users: ${totalUsers}\n📥 Downloads: ${totalDl}\n📢 Channels: ${channels.join(', ')}`;
        bot.sendMessage(chatId, statsMsg, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "➕ Add Channel", callback_data: 'add_ch' }, { text: "❌ Remove Channel", callback_data: 'rem_ch' }]
                ]
            }
        });
        return;
    }

    // Admin Input Handlers
    if (adminState[chatId] === 'add') {
        const snap = await db.ref('channels').once('value');
        let channels = snap.val() || [];
        channels.push(text);
        await db.ref('channels').set(channels);
        adminState[chatId] = null;
        return bot.sendMessage(chatId, "✅ Added!");
    }

    if (adminState[chatId] === 'rem') {
        const snap = await db.ref('channels').once('value');
        let channels = snap.val() || [];
        channels = channels.filter(c => c !== text);
        await db.ref('channels').set(channels);
        adminState[chatId] = null;
        return bot.sendMessage(chatId, "✅ Removed!");
    }

    if (text && text.startsWith('http')) {
        const subscribed = await isSubscribed(chatId);
        if (!subscribed) {
            const snap = await db.ref('channels').once('value');
            const channels = snap.val() || [];
            const links = channels.map(c => `👉 [Join](https://t.me/${c.replace('@','')})`).join('\n');
            return bot.sendMessage(chatId, `⚠️ Join first:\n${links}`, { parse_mode: 'Markdown' });
        }

        try { await bot.setMessageReaction(chatId, msg.message_id, { reaction: [{ type: 'emoji', emoji: '👀' }] }); } catch(e){}

        userRequests[chatId] = text;
        bot.sendMessage(chatId, "Select format:", {
            reply_markup: {
                inline_keyboard: [[{ text: "🎥 Video", callback_data: 'v' }, { text: "🎵 Audio", callback_data: 'a' }]]
            }
        });
    }
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === 'add_ch') { adminState[chatId] = 'add'; return bot.sendMessage(chatId, "Send @username:"); }
    if (q.data === 'rem_ch') { adminState[chatId] = 'rem'; return bot.sendMessage(chatId, "Send @username to remove:"); }

    const url = userRequests[chatId];
    if (!url) return;

    bot.answerCallbackQuery(q.id, { text: "📥 Fetching..." });
    const res = await fetchVideoData(url);
    if (res && res.data && res.data.medias) {
        const file = q.data === 'v' ? res.data.medias.find(m => m.type === 'video') : res.data.medias.find(m => m.extension === 'mp3');
        if (file) {
            if (q.data === 'v') await bot.sendVideo(chatId, file.url);
            else await bot.sendAudio(chatId, file.url);
            
            // Increment Download Count in Firebase
            db.ref('totalDownloads').transaction(c => (c || 0) + 1);
        }
    }
});

app.get('/api/download', async (req, res) => {
    const data = await fetchVideoData(req.query.url);
    res.json(data);
});

app.listen(PORT, () => console.log("Server Live"));

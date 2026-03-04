const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

async function fetchVideoData(videoUrl) {
    try {
        const apiUrl = `https://r-gengpt-api.vercel.app/api/video/download?url=${encodeURIComponent(videoUrl)}`;
        const response = await axios.get(apiUrl);
        return response.data;
    } catch (error) {
        return null;
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome! Send a link to download video.");
    } else if (text.startsWith('http')) {
        bot.sendMessage(chatId, "Processing...");
        const result = await fetchVideoData(text);
        if (result && result.data && result.data.medias) {
            const videoUrl = result.data.medias[0].url;
            bot.sendVideo(chatId, videoUrl);
        } else {
            bot.sendMessage(chatId, "Failed to fetch video.");
        }
    }
});

app.get('/api/download', async (req, res) => {
    const videoUrl = req.query.url;
    const data = await fetchVideoData(videoUrl);
    res.json(data);
});

app.listen(PORT, () => console.log('Running...'));

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Webhook Verification (for Facebook)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Handling incoming messages
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED'); // Send 200 immediately to acknowledge receipt

        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;
                console.log(`Received message from ${sender_psid}: ${userMessage}`);

                // Get AI response
                const aiReply = await getGeminiResponse(userMessage);

                // Send back to user
                await sendMessageToFacebook(sender_psid, aiReply);
            }
        }
    } else {
        res.sendStatus(404);
    }
});

async function getGeminiResponse(prompt) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const systemInstruction = "You are a helpful Facebook page assistant. Reply in friendly Bengali. Answer concisely.";
        
        const requestBody = {
            contents: [
                {
                    parts: [
                        { text: systemInstruction + "\n\nUser Message: " + prompt }
                    ]
                }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।";
    } catch (error) {
        console.error("Error connecting to Gemini:", error);
        return "দুঃখিত, কোনো একটি সমস্যা হয়েছে।";
    }
}

async function sendMessageToFacebook(sender_psid, responseText) {
    try {
        const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
        const requestBody = {
            recipient: { id: sender_psid },
            message: { text: responseText }
        };

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
    } catch (error) {
        console.error("Error sending message to Facebook:", error);
    }
}

app.listen(PORT, () => {
    console.log(`Webhook server is running on port ${PORT}`);
});

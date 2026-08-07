const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 🌟 আপনার প্রোডাক্টের আসল ছবির লিংকটি এখানে দিন
const PRODUCT_IMAGE_URL = "https://eakub.pro.bd/charger.jpg"; 

// Cron-job.org এর জন্য রাউট
app.get('/', (req, res) => {
    res.status(200).send("E-commerce Bot Server is awake!");
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

function downloadAudioBase64(urlStr) {
    return new Promise((resolve, reject) => {
        https.get(urlStr, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                https.get(res.headers.location, (res2) => {
                    const chunks = [];
                    res2.on('data', (chunk) => chunks.push(chunk));
                    res2.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
                }).on('error', reject);
            } else {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
            }
        }).on('error', reject);
    });
}

function httpsPost(url, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                let parsedBody = body;
                try { parsedBody = JSON.parse(body); } catch(e) {}
                resolve(parsedBody);
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            if (entry.messaging) {
                const webhook_event = entry.messaging[0];
                const sender_psid = webhook_event.sender.id;

                if (webhook_event.message) {
                    let userMessage = webhook_event.message.text;
                    let audioBase64 = null;

                    if (webhook_event.message.attachments) {
                        for (const attachment of webhook_event.message.attachments) {
                            if (attachment.type === 'audio') {
                                try { audioBase64 = await downloadAudioBase64(attachment.payload.url); } catch(e) {}
                                break;
                            }
                        }
                    }

                    if (userMessage || audioBase64) {
                        try {
                            let aiReply = await getGeminiResponse(userMessage, audioBase64);
                            if (aiReply) {
                                if (aiReply.includes('[SEND_IMAGE]')) {
                                    aiReply = aiReply.replace('[SEND_IMAGE]', '').trim();
                                    await sendMessageToFacebook(sender_psid, aiReply);
                                    await sendImageToFacebook(sender_psid, PRODUCT_IMAGE_URL);
                                } else {
                                    await sendMessageToFacebook(sender_psid, aiReply);
                                }
                            }
                        } catch (e) { console.error(e); }
                    }
                }
            }

            if (entry.changes) {
                for (const change of entry.changes) {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                        const comment_id = change.value.comment_id;
                        const message = change.value.message;
                        const sender_id = change.value.from.id;
                        const page_id = entry.id;

                        if (sender_id !== page_id) {
                            try {
                                let aiReply = await getGeminiResponse(message, null);
                                if (aiReply) await replyToComment(comment_id, aiReply);
                            } catch (e) {}
                        }
                    }
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// 🌟 এআই বটের মেমোরি / সিস্টেম ইন্সট্রাকশন
const training_text = `You are a highly skilled and friendly sales assistant for an E-commerce Facebook page in Bangladesh selling the "M4+ 120W Retractable Car Charger".
IMPORTANT RULES:
1. You MUST reply ONLY in Bengali (using Bengali script). Do not use English script.
2. Keep your replies friendly, polite, persuasive, and natural.
3. Use emojis to make the conversation engaging.
4. If a customer asks to see a real picture or photo of the product, you MUST include this exact secret tag in your reply: [SEND_IMAGE]. The system will use this tag to attach the photo.
5. If a customer asks to order, ask for their: Full Name, Phone Number, and Full Delivery Address.

PRODUCT DETAILS (M4+ 120W Retractable Car Charger Edition):
- Key Features: 80cm auto-retractable cables. Solves messy cable problems in cars!
- Ports (5-in-1): 1 Type-C fixed cable, 1 iPhone fixed cable, 1 USB-A port, 2 Type-C female ports.
- Power: 120W super fast shared charging. Can charge 5 devices at once.
- Safety: Smart safety protection chip, 180-degree flexible pivot joint, Live digital voltage display.

PRICE & DELIVERY:
- 1 Piece (Single Pack): ৳990
- 2 Pieces (Combo Offer): ৳1,850 [Save ৳130]
- Delivery Charge: Inside Dhaka ৳60, Outside Dhaka ৳100.
- Payment Method: Cash on Delivery (Pay after receiving the product).
- Delivery Time: Within 72 hours across Bangladesh.`;

async function getGeminiResponse(text, audioBase64) {
    if (!GEMINI_API_KEY) return "সিস্টেম এরর: API Key পাওয়া যায়নি!";
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    
    let partsArray = [];
    if (text) partsArray.push({ text: text });
    else if (audioBase64) partsArray.push({ text: "কাস্টমার একটি ভয়েস মেসেজ পাঠিয়েছেন। দয়া করে সেটি শুনুন এবং উপরের নির্দেশিকা অনুযায়ী বাংলায় রিপ্লাই দিন।" });

    if (audioBase64) {
        partsArray.push({ inlineData: { mimeType: "audio/mp4", data: audioBase64 } });
    }

    const payload = {
        systemInstruction: { parts: [{ text: training_text }] },
        contents: [{ parts: partsArray }]
    };

    try {
        const data = await httpsPost(url, payload);
        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        }
        return "আমি এই মুহূর্তে উত্তর দিতে পারছি না, দয়া করে একটু পর আবার চেষ্টা করুন।";
    } catch (error) {
        return "দুঃখিত, আমাদের টেকনিক্যাল কিছু সমস্যা হচ্ছে।";
    }
}

async function sendMessageToFacebook(sender_psid, text) {
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = { recipient: { id: sender_psid }, message: { text: text } };
    const response = await httpsPost(url, payload);
    if (response.error) console.error("❌ FB Send Error:", response.error);
}

async function sendImageToFacebook(sender_psid, imageUrl) {
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = { 
        recipient: { id: sender_psid }, 
        message: { 
            attachment: {
                type: "image",
                payload: { url: imageUrl, is_reusable: true }
            }
        } 
    };
    const response = await httpsPost(url, payload);
    if (response.error) console.error("❌ FB Image Error:", response.error);
}

async function replyToComment(comment_id, text) {
    const url = `https://graph.facebook.com/v20.0/${comment_id}/comments?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = { message: text };
    try { await httpsPost(url, payload); } catch (e) {}
}

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

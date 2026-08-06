const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
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

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            // ১. মেসেঞ্জারের মেসেজ চেক করা
            if (entry.messaging) {
                const webhook_event = entry.messaging[0];
                const sender_psid = webhook_event.sender.id;

                if (webhook_event.message) {
                    let userMessage = webhook_event.message.text;
                    let audioBase64 = null;

                    if (webhook_event.message.attachments) {
                        for (const attachment of webhook_event.message.attachments) {
                            if (attachment.type === 'audio') {
                                try {
                                    audioBase64 = await downloadAudioBase64(attachment.payload.url);
                                } catch(e) { console.error(e); }
                                break;
                            }
                        }
                    }

                    if (userMessage || audioBase64) {
                        try {
                            if (userMessage) console.log(`[New Message]: ${userMessage}`);
                            else console.log(`[New Audio Message Received]`);
                            
                            let aiReply = await getGeminiResponse(userMessage, audioBase64);
                            
                            if (aiReply) {
                                await sendMessageToFacebook(sender_psid, aiReply);
                                console.log(`[Message Reply Sent Request Processed]`);
                            }
                        } catch (e) { console.error(e); }
                    }
                }
            }

            // ২. ফেসবুক পোস্টের কমেন্ট চেক করা
            if (entry.changes) {
                for (const change of entry.changes) {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                        const comment_id = change.value.comment_id;
                        const message = change.value.message;
                        const sender_id = change.value.from.id;
                        const page_id = entry.id;

                        // পেজ যদি নিজেই কমেন্ট করে, তবে সেটার রিপ্লাই দেওয়া যাবে না
                        if (sender_id !== page_id) {
                            try {
                                console.log(`[New Comment]: ${message}`);
                                let aiReply = await getGeminiResponse(message, null);
                                
                                if (aiReply) {
                                    await replyToComment(comment_id, aiReply);
                                    console.log(`[Comment Reply Sent Request Processed]`);
                                }
                            } catch (e) { console.error('Error handling comment:', e); }
                        }
                    }
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

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
                
                if (res.statusCode >= 400) {
                    console.error(`\n❌ [Facebook API Error] Status: ${res.statusCode}`);
                    console.error(JSON.stringify(parsedBody, null, 2));
                    console.error(`-----------------------------------------\n`);
                }
                
                resolve(parsedBody);
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

// ব্রেইন রিসেট! এখন সে শুধু একটি সাধারণ এআই। 
const training_text = `তুমি একটি সাধারণ, স্মার্ট এবং হেল্পফুল এআই অ্যাসিস্ট্যান্ট। তোমার কাজ হলো মানুষের যেকোনো প্রশ্নের সুন্দর করে উত্তর দেওয়া। তুমি একদম স্বাভাবিক মানুষের মতো করে কথা বলবে। কোনো নির্দিষ্ট ব্র্যান্ড বা কোম্পানির হয়ে কথা বলবে না।`;

async function getGeminiResponse(text, audioBase64) {
    if (!GEMINI_API_KEY) return "System error: API Key missing!";
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    
    let partsArray = [];
    if (text) partsArray.push({ text: text });
    else if (audioBase64) partsArray.push({ text: "কাস্টমার একটি ভয়েস মেসেজ পাঠিয়েছে। ভয়েস মেসেজটি শুনে উত্তর দাও।" });

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
        return "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।";
    } catch (error) {
        return "দুঃখিত, আমার সার্ভারে সমস্যা হচ্ছে।";
    }
}

async function sendMessageToFacebook(sender_psid, text) {
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = { recipient: { id: sender_psid }, message: { text: text } };
    await httpsPost(url, payload);
}

async function replyToComment(comment_id, text) {
    const url = `https://graph.facebook.com/v20.0/${comment_id}/comments?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = { message: text };
    try { await httpsPost(url, payload); } catch (e) { console.error(e); }
}

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

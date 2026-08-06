const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 🔒 Secured Unsplash Access Key
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

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

// আনস্প্ল্যাশ থেকে ডেটা আনার জন্য ফাংশন
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } 
                catch(e) { resolve(body); }
            });
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

// Unsplash থেকে রিয়েল ছবি এনে পোস্ট করার ফাংশন
async function autoPostToFacebook() {
    try {
        // ১. Unsplash থেকে অসাধারণ একটি রিয়েল ছবি আনা
        const unsplashUrl = `https://api.unsplash.com/photos/random?query=switzerland,alps,nature,landscape&orientation=landscape&client_id=${UNSPLASH_ACCESS_KEY}`;
        const unsplashData = await httpsGet(unsplashUrl);
        
        if (!unsplashData || !unsplashData.urls) {
            console.error("Unsplash error:", unsplashData);
            return;
        }

        // ছবিটিকে আল্ট্রা-এইচডি (4K) কোয়ালিটিতে নেওয়ার জন্য regular এর বদলে full ব্যবহার করা হলো
        const imageUrl = unsplashData.urls.full;
        
        // ছবির ভেতরে কী আছে সেটি পড়ে নেওয়া
        const imageDescription = unsplashData.description || unsplashData.alt_description || "A breathtaking natural landscape in Switzerland";

        // ২. Gemini-কে ছবির বর্ণনা দিয়ে সুন্দর একটি ক্যাপশন লেখানো
        const prompt = `You are an expert social media manager for a Premium Nature Photography Facebook page.
I have a beautiful photograph with the following description: "${imageDescription}"
Write a highly engaging, breathtaking Facebook post caption for this exact photo (targeting a USA audience).
Include emojis and popular hashtags (like #Nature #Switzerland #Wanderlust).
Only return the caption text, nothing else.`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
        const payload = { contents: [{ parts: [{ text: prompt }] }] };
        
        const geminiData = await httpsPost(geminiUrl, payload);
        let caption = geminiData.candidates[0].content.parts[0].text.trim();

        // ৩. ফেসবুকে পোস্ট করা
        const fbUrl = `https://graph.facebook.com/v20.0/me/photos?access_token=${PAGE_ACCESS_TOKEN}`;
        const fbPayload = { url: imageUrl, message: caption };
        
        const fbResponse = await httpsPost(fbUrl, fbPayload);
        console.log("✅ Auto-Post Success with Unsplash:", fbResponse);
    } catch (e) {
        console.error("❌ Error in autoPostToFacebook:", e);
    }
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
                                try {
                                    audioBase64 = await downloadAudioBase64(attachment.payload.url);
                                } catch(e) {}
                                break;
                            }
                        }
                    }

                    if (userMessage || audioBase64) {
                        try {
                            if (userMessage && userMessage.toLowerCase() === 'post now') {
                                await sendMessageToFacebook(sender_psid, "Fetching a 4K masterpiece from Unsplash and generating caption... Please check your page after 15 seconds!");
                                await autoPostToFacebook();
                            } else {
                                let aiReply = await getGeminiResponse(userMessage, audioBase64);
                                if (aiReply) await sendMessageToFacebook(sender_psid, aiReply);
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

const training_text = `You are an expert social media manager and friendly assistant for a Premium Nature Photography Facebook page. 
IMPORTANT RULES:
1. You MUST reply ONLY in English. Do not use Bengali or any other language.
2. Keep your replies short, natural, and engaging (1-2 sentences maximum).
3. If someone praises the photo, give a short friendly thank you with an emoji.
4. If someone asks "Where is this?" or "Location?", give a relevant, imaginative, and beautiful location name (e.g., "This is inspired by the breathtaking Swiss Alps!").
5. Be polite, warm, and professional.`;

async function getGeminiResponse(text, audioBase64) {
    if (!GEMINI_API_KEY) return "System error: API Key missing!";
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
    
    let partsArray = [];
    if (text) partsArray.push({ text: text });
    else if (audioBase64) partsArray.push({ text: "The user sent an audio message. Please listen to it and reply according to your instructions." });

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
        return "I am unable to answer right now, please try again later.";
    } catch (error) {
        return "Sorry, we are facing some technical issues.";
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
    try { await httpsPost(url, payload); } catch (e) {}
}

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

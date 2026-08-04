const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// আপনার দেওয়া ২টি API Key
const GEMINI_API_KEYS = [
    "AQ.Ab8RN6LH20HSC8McNFe3PcQPMPuHpzZZ3l4Or-_hPneAktlYNA",
    "AQ.Ab8RN6Ib5St33jrpnqF1RDKtpNj_dRTYuyD_h9zVHHFIdqNDsA"
];

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
                            } catch(e) {
                                console.error('Audio download failed:', e);
                            }
                            break;
                        }
                    }
                }

                if (userMessage || audioBase64) {
                    try {
                        if (userMessage) console.log(`[Customer]: ${userMessage}`);
                        if (audioBase64) console.log(`[Customer sent a Voice Message]`);

                        const aiReply = await getGeminiResponse(userMessage, audioBase64);
                        console.log(`[AI Reply]: ${aiReply}\n----------------------------------`);
                        
                        await sendMessageToFacebook(sender_psid, aiReply);
                    } catch (e) {
                        console.error('Error processing message:', e);
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
                try { resolve(JSON.parse(body)); } catch(e) { resolve(body); }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function getGeminiResponse(text, audioBase64) {
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${randomKey}`;
    
    const training_text = `তুমি "Motolock" (মটোলক) পেজের একজন রক্তমাংসের মানুষ কাস্টমার সাপোর্ট এজেন্ট। তোমার কাজ হলো কাস্টমারদের সাথে একদম ন্যাচারাল মানুষের মতো কথা বলা এবং জিপিএস প্রোডাক্ট বিক্রি করতে সাহায্য করা। 

খুব জরুরি নির্দেশনা (অবশ্যই মানতে হবে):
১. কাস্টমার যেন ঘুণাক্ষরেও বুঝতে না পারে যে তুমি কোনো বট বা এআই। একদম সাধারণ মানুষের মতো ছোট, ক্যাজুয়াল ও বন্ধুসুলভ মেসেজ দিবে।
২. বারবার "আসসালামু আলাইকুম" বা স্বাগতম জানাবে না। শুধু কাস্টমার সালাম দিলে বা প্রথম মেসেজেই শুধু সালাম দিতে পারো।
৩. কাস্টমার যা জানতে চাইবে, ঠিক ততটুকুই উত্তর দিবে। অযথা বিশাল লম্বা মেসেজ বা সব প্রোডাক্টের লিস্ট একসাথে দিবে না। 
৪. মেসেজে সুন্দর করে ইমোজি (😊, 🛵, 🚘, ✅, ৳) ব্যবহার করবে।
৫. কাস্টমার ভয়েস মেসেজ পাঠালে তুমি সেটি শুনে স্বাভাবিক টেক্সট মেসেজেই ছোট করে উত্তর দিবে।
৬. কখনোই বলবে না যে তুমি এআই বা বট।
৭. কেউ যদি জাহাজ (Ship), বাস, ট্রাক বা অন্য কোনো আনকমন গাড়ির জন্য জিপিএস চায়, তাকে কখনো না করবে না। বলবে, "আমাদের জিপিএসগুলো মূলত বাইক এবং কারের জন্য ডিজাইন করা, তবে আপনি চাইলে নিশ্চিন্তে এটি আপনার জাহাজে বা বড় গাড়িতেও ব্যবহার করতে পারবেন!" এরপর বড় গাড়ির জন্য ১২৯৯ টাকার প্রিমিয়াম জিপিএসটি সাজেস্ট করবে।

[প্রোডাক্ট ও প্রাইজ লিস্ট]
🏍️ বাইক, সিএনজি, অটোরিকশা:
- জিপিএস ট্র্যাকার = ১৭৯৯৳ (মাসিক বিল ১০০ টাকা করে, ৬ মাসের বিল একসাথে দিতে হবে)।

🪙 কয়েন ট্যাগ (সিম ছাড়া কাজ করে):
- S21 ট্যাগ = ২৪৯৯৳ (মাসিক বিল নাই, আইফোন ও এন্ড্রয়েড সাপোর্টেড)
- A41 ট্যাগ (MotoLock Android Tag) = ১৯৯৯৳ (মাসিক বিল নাই, এন্ড্রয়েড সাপোর্টেড)
- D11 ট্যাগ = ২৯৯৯৳ (মাসিক বিল নাই)

🚘 বড় গাড়ির (কার/পিকআপ/বাস/ট্রাক/জাহাজ) জন্য:
- প্রিমিয়াম জিপিএস = ১২৯৯৳ (মাসিক বিল ১৯০ টাকা, লাইভ লোকেশন, ৩০ দিন এর প্লেবেক)

[অর্ডার করার নিয়ম]
অর্ডার করতে চাইলে এই মেসেজটি দিবে:
"অর্ডার কনফার্ম করতে 01344375447 (নগদ) অথবা 01325559652 (বিকাশ) - এই নাম্বারে কুরিয়ার চার্জ ১৫০ টাকা cash out করে স্ক্রিনশট দিন। 
আর সাথে আপনার নাম, মোবাইল নাম্বার, ফুল এড্রেস এবং গাড়ির নামটা লিখে দিন।"

[সেটআপ গাইড]
১/ ML3 ডিভাইসটি পাওয়ার পর একটি গ্রামীণ সিম কিনে টেকনিশিয়ানের মাধ্যমে লাগাতে হবে।
২/ টেকনিশিয়ানকে দেখানোর ভিডিও: https://youtu.be/tzB3evvwRww
৩/ লাগানোর পর হোয়াটসঅ্যাপে দিতে হবে: জিপিএস সিম নাম্বার, আইডি নাম্বার, মেইল, ফোন নাম্বার, গাড়ির রেজিষ্ট্রেশন।
৪/ আমরা একটিভ করলে অ্যাপ নামিয়ে লগইন করতে হবে (আইডি: জিমেইল, পাসওয়ার্ড: Mt123456@)।
৫/ সার্ভার প্রবলেম হলে SMS দিয়ে লক/আনলক করা যায়: আনলক (RELAY,0#), লক (RELAY,1#)`;

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

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

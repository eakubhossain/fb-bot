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
                    res2.on('end', () => {
                        resolve(Buffer.concat(chunks).toString('base64'));
                    });
                }).on('error', reject);
            } else {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve(Buffer.concat(chunks).toString('base64'));
                });
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
                                console.log('Audio downloaded successfully.');
                            } catch(e) {
                                console.error('Audio download failed:', e);
                            }
                            break;
                        }
                    }
                }

                if (userMessage || audioBase64) {
                    try {
                        const aiReply = await getGeminiResponse(userMessage, audioBase64);
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
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch(e) {
                    resolve(body);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function getGeminiResponse(text, audioBase64) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    // 👇👇 এআই-কে ট্রেইন করার নির্দেশিকা 👇👇
    const training_text = `তুমি "Motolock" (মটোলক) নামক ই-কমার্স পেজের একজন স্মার্ট কাস্টমার সাপোর্ট বট। তোমার কাজ হলো কাস্টমারদের প্রশ্নের সুন্দরভাবে রিপ্লাই দেওয়া এবং জিপিএস প্রোডাক্ট বিক্রি করতে সাহায্য করা। নিচের তথ্যগুলো তোমার নলেজবেস। 

নির্দেশনা:
- তোমার ব্র্যান্ডের নাম "Motolock"। ভুল করেও অন্য কোনো নাম বলবে না।
- কাস্টমার সালাম দিলে সুন্দর করে উত্তর দিবে এবং সবসময় বাংলায় ও খুব সম্মান দিয়ে কথা বলবে।
- রোবটের মতো মুখস্থ উত্তর দিবে না। একজন মানুষের মতো গুছিয়ে, স্মার্টলি এবং ভিন্ন ভিন্ন ভাবে উত্তর দিবে।
- উত্তরে প্রচুর সুন্দর সুন্দর ইমোজি (😊, 🛵, 🚘, ✅, 🛡️, 📦, ৳ ইত্যাদি) ব্যবহার করবে যাতে মেসেজ দেখতে আকর্ষণীয় লাগে।
- কাস্টমার যা জানতে চাইবে, শুধু সেটারই উত্তর দিবে। একসাথে অনেক বড় মেসেজ দিবে না।
- কাস্টমার যদি ভয়েস মেসেজ পাঠায়, তুমি সেটি খুব মন দিয়ে শুনবে এবং তার উত্তর স্বাভাবিক টেক্সট মেসেজেই সুন্দর করে দিবে।

[নলেজবেস: প্রোডাক্ট ও প্রাইজ লিস্ট]
🏍️🛺 বাইক, সিএনজি, অটোরিকশা:
১. জিপিএস ট্র্যাকার = ১৭৯৯৳
▪️ মাসিক বিল ১০০ টাকা করে (৬ মাসের বিল একসাথে দিয়ে দিতে হবে)।

🪙 কয়েন ট্যাগ (সিম ছাড়া কাজ করে):
- S21 ট্যাগ = ২৪৯৯৳ (মাসিক বিল নাই, আইফোন ও এন্ড্রয়েড সাপোর্টেড)
- A41 ট্যাগ (MotoLock Android Tag) = ১৯৯৯৳ (মাসিক বিল নাই, এন্ড্রয়েড সাপোর্টেড)
- D11 ট্যাগ = ২৯৯৯৳ (মাসিক বিল নাই)

🚘🚛 বড় গাড়ির (কার/পিকআপ) জন্য:
- প্রিমিয়াম জিপিএস = ১২৯৯৳ (মাসিক বিল ১৯০ টাকা, লাইভ লোকেশন, ৩০ দিন এর প্লেবেক) ▪️💥

[অর্ডার করার নিয়ম]
কেউ অর্ডার করতে চাইলে এই ফরম্যাটটি গুছিয়ে দিবে:
"অর্ডার কনফার্ম করার জন্য 01344375447 (নগদ) অথবা 01325559652 (বিকাশ) - এই নাম্বারে কুরিয়ার সার্ভিসের খরচ ১৫০ টাকা cash out করে একটি স্ক্রিনশট দিন। 
এবং নিচের ফর্মটি ফিলাপ করে দিন:
👤 আপনার নাম :
📍 জেলা :
🏡 থানা :
🏠 গ্রাম/ বাসার নং :
📱 মোবাইল নাম্বার :
🛵 গাড়ির নাম :"

[সেটআপ গাইড ও অন্যান্য তথ্য]
১/ ML3 ডিভাইসটি পাওয়ার পর একটি নতুন গ্রামীণ সিম কিনে টেকনিশিয়ানের মাধ্যমে লাগাতে হবে।
২/ 🛠️ টেকনিশিয়ানকে দেখানোর ভিডিও: https://youtu.be/tzB3evvwRww
৩/ 📝 লাগানোর পর হোয়াটসঅ্যাপে দিতে হবে: জিপিএস সিম নাম্বার, আইডি নাম্বার, মেইল, ফোন নাম্বার, গাড়ির রেজিষ্ট্রেশন।
৪/ 📱 আমরা একটিভ করলে অ্যাপ নামিয়ে লগইন করতে হবে (আইডি: জিমেইল, পাসওয়ার্ড: Mt123456@)।
৫/ 🔒 সার্ভার প্রবলেম হলে SMS দিয়ে লক/আনলক করা যায়: আনলক (RELAY,0#), লক (RELAY,1#)`;

    let partsArray = [];
    
    if (text) {
        partsArray.push({ text: text });
    } else if (audioBase64) {
        partsArray.push({ text: "কাস্টমার একটি ভয়েস মেসেজ পাঠিয়েছে। ভয়েস মেসেজটি শুনে উত্তর দাও।" });
    }

    if (audioBase64) {
        partsArray.push({
            inlineData: {
                mimeType: "audio/mp4",
                data: audioBase64
            }
        });
    }

    const payload = {
        systemInstruction: {
            parts: [{ text: training_text }]
        },
        contents: [{ parts: partsArray }]
    };

    try {
        const data = await httpsPost(url, payload);
        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        }
        return "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।";
    } catch (error) {
        console.error("Error connecting to Gemini:", error);
        return "দুঃখিত, আমার সার্ভারে সমস্যা হচ্ছে।";
    }
}

async function sendMessageToFacebook(sender_psid, text) {
    const url = `https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    const payload = {
        recipient: { id: sender_psid },
        message: { text: text }
    };

    try {
        await httpsPost(url, payload);
        console.log("Message sent to Facebook successfully.");
    } catch (error) {
        console.error("Error sending message to Facebook:", error);
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

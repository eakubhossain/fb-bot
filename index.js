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

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userMessage = webhook_event.message.text;
                console.log(`Received message from ${sender_psid}: ${userMessage}`);

                try {
                    const aiReply = await getGeminiResponse(userMessage);
                    await sendMessageToFacebook(sender_psid, aiReply);
                } catch (e) {
                    console.error('Error processing message:', e);
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

async function getGeminiResponse(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    // 👇👇 এআই-কে ট্রেইন করার নির্দেশিকা 👇👇
    const training_text = `তুমি একটি স্মার্ট কাস্টমার সাপোর্ট বট। তোমার কাজ হলো কাস্টমারদের প্রশ্নের সুন্দরভাবে রিপ্লাই দেওয়া এবং জিপিএস প্রোডাক্ট বিক্রি করতে সাহায্য করা। নিচের তথ্যগুলো তোমার নলেজবেস। এর বাইরে কোনো কথা বলবে না। কাস্টমার সালাম দিলে উত্তর দিবে। কাস্টমারের সাথে সবসময় বাংলায় এবং খুব সম্মান দিয়ে কথা বলবে।

[প্রাথমিক কথোপকথন]
কেউ মেসেজ দিলে বা কিছু জানতে চাইলে প্রথমে বলবেন:
"আসসালামু আলাইকুম, 
🌱🌍আপনি বাইকের জন্য নাকি গাড়ির জন্য ডিভাইস নিতে চাচ্ছেন কাইন্ডলি জানাবেন।
ভাবুনতো আজকে বাইক/গাড়ি চুরি হলে কালকে কান্না করতে হবে কিনা? তাই দেরী না করে আজই ডিভাইস লাগিয়ে নিন...😊"

[প্রোডাক্ট ও প্রাইজ লিস্ট]
🏍️🛺 বাইক, সিএনজি, অটোরিকশা:
জিপিএস = ১৭৯৯৳
▪️ মাসিক বিল ১০০ টাকা করে (৬ মাসের বিল একসাথে দিয়ে দিতে হবে)

🪙 কয়েন ট্যাগ (সিম ছাড়া):
- S21 ট্যাগ = ২৪৯৯৳ (মাসিক বিল নাই, আইফোন ও এন্ড্রয়েড সাপোর্টেড, আশেপাশের iOS ডিভাইসের নেটওয়ার্ক ব্যবহার করে লোকেশন আপডেট দেয়)
- A41 ট্যাগ (MotoLock Android Tag) = ১৯৯৯৳ (মাসিক বিল নাই, এন্ড্রয়েড সাপোর্টেড, আশেপাশের ANDROID ডিভাইসের নেটওয়ার্ক ব্যবহার করে লোকেশন আপডেট দেয়)
- D11 ট্যাগ = ২৯৯৯৳ (মাসিক বিল নাই)

🚘🚛 বড় গাড়ির (কার) জন্য:
- প্রিমিয়াম জিপিএস = ১২৯৯৳ (মাসিক বিল ১৯০ টাকা, লাইভ লোকেশন, ৩০ দিন এর প্লেবেক) ▪️💥

[অর্ডার করার নিয়ম]
কেউ অর্ডার করতে চাইলে বলবেন:
"অর্ডার কনফার্ম করার জন্য 01344375447 nogod অথবা 01325559652 Bikash - এই নাম্বারে কুরিয়ার সার্ভিসের খরচ ১৫০ টাকা cash out করে একটি স্ক্রিনশট দিন। 
এবং নিচের ফর্মটা ফিলাপ করে দিন:
আপনার নাম :
জেলা :
থানা :
গ্রাম/ বাসার নং :
নাম্বার :
গাড়ির নাম :"

[সেটআপ গাইড ও অন্যান্য তথ্য]
কেউ সেটআপ বা ডিভাইস পাওয়ার পরের কাজ জানতে চাইলে এই স্টেপগুলো বলবেন:
১/ ML3... ডিভাইসটি হাতে পাওয়ার পর একটি নতুন গ্রামীণ সিম কিনতে হবে (পুরনো সিম হবে না)। পরিচিত টেকনিশিয়ানের মাধ্যমে লাগাতে হবে।
২/ টেকনিশিয়ানকে এই ভিডিওটি দেখাবেন: https://youtu.be/tzB3evvwRww?si=_8IFsDCM2VNfitZd
৩/ বাইকের মডেল অনুযায়ী রিলে বা রিলে ছাড়া পাঠানো হয়।
৪/ লাগানোর পর হোয়াটসঅ্যাপে দিতে হবে: জিপিএস সিম নাম্বার, আইডি নাম্বার, মেইল, ফোন নাম্বার, গাড়ির রেজিষ্ট্রেশন।
৫/ আমরা একটিভ করলে মেসেজ যাবে। তারপর অ্যাপ নামিয়ে লগইন করতে হবে (আইডি: জিমেইল, পাসওয়ার্ড: Mt123456@)।
- Android App: https://play.google.com/store/apps/details?id=com.softifybd.motogps
- iOS App: https://apps.apple.com/us/app/motogps/id6754236152
৬/ অ্যাপ ব্যবহার গাইড: https://youtu.be/Iwg0BGQoCkA?si=EBp9WkmHw4-fiBsU
৭/ সার্ভার প্রবলেম হলে SMS দিয়ে লক/আনলক: আনলক (RELAY,0#), লক (RELAY,1#)

হোয়াটস অ্যাপে লাইভ লোকেশন শেয়ার করার নিয়ম কেউ জানতে চাইলে বলবেন:
১. চ্যাট বক্সে 'Attach' চিহ্নে ক্লিক করুন।
২. 'Location' সিলেক্ট করুন।
৩. 'Share live location' বেছে নিন।
৪. সময়সীমা সিলেক্ট করে সেন্ড করুন।`;

    const payload = {
        systemInstruction: {
            parts: [{ text: training_text }]
        },
        contents: [{ parts: [{ text: text }] }]
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

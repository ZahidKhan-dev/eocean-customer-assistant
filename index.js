require("dotenv").config();

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const http = require("http");

let latestQr = null;

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

if (!WEBHOOK_URL) {
    throw new Error("N8N_WEBHOOK_URL is missing from .env");
}

const FALLBACK_REPLY = "Sorry, something went wrong on our side. Please try again in a moment 🙏";

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.WHATSAPP_SESSION_NAME || "eocean-customer-assistant",
        dataPath: process.env.WWEBJS_AUTH_PATH || "./.wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

client.on("qr", (qr) => {
    latestQr = qr;
    console.log("New WhatsApp QR code generated. Open the QR page to scan it.");
});
client.on("ready", () => {
    console.log("WhatsApp connected successfully.");
});

client.on("auth_failure", (msg) => {
    console.error("Authentication failed:", msg);
});

client.on("disconnected", (reason) => {
    console.error("WhatsApp disconnected:", reason);
});
client.on("message_create", (message) => {
    console.log("MESSAGE_CREATE EVENT:", {
        from: message.from,
        to: message.to,
        fromMe: message.fromMe,
        type: message.type,
        body: message.body
    });
});

client.on("message", async (message) => {
    let typingTimer = null;
    let chat = null;

    try {
        // ignore my own messages, groups and status updates
        if (message.fromMe) return;
        if (message.from.endsWith("@g.us")) return;
        if (message.from === "status@broadcast") return;

        const sender = message.from.split("@")[0];
        const text = (message.body || "").trim();
        const isVoice = message.type === "ptt" || message.type === "audio";

        console.log("Incoming:", message.type, text ? `"${text}"` : "(no text)");

        // images, videos, stickers, files, locations, contacts: reply politely
        const unsupportedTypes = ["image", "video", "sticker", "document", "location", "vcard", "multi_vcard"];
        if (unsupportedTypes.includes(message.type)) {
            console.log("Unsupported type, sending polite reply:", message.type);
            await client.sendMessage(
                message.from,
                "Thank you for your message 😊 I can read text and voice notes only. Could you please type your question or send a voice note?"
            );
            console.log("Polite reply sent.");
            return;
        }

        // ignore anything else that has no text (system messages, etc.)
        if (!isVoice && !text) return;

        // typing effect
        try {
            chat = await message.getChat();
            await chat.sendStateTyping();
            typingTimer = setInterval(() => {
                chat.sendStateTyping().catch(() => {});
            }, 20000);
        } catch (e) {
            console.log("Typing effect not available:", e.message);
        }

        const payload = {
            from: sender,
            type: isVoice ? "ptt" : "chat",
            message: text
        };

        // download the voice note and send it to n8n as base64
        if (isVoice) {
            if (!message.hasMedia) {
                console.log("Voice note has no media, skipping.");
                return;
            }

            let media;
            try {
                media = await message.downloadMedia();
            } catch (e) {
                console.error("Could not download voice note:", e.message);
                await message.reply("Sorry, I could not open your voice note. Please try again.");
                return;
            }

            if (!media || !media.data) {
                await message.reply("Sorry, I could not read your voice note. Please try again.");
                return;
            }

            payload.audio = media.data;
            payload.mimetype = (media.mimetype || "audio/ogg").split(";")[0];
        }

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) {
            throw new Error(`n8n returned HTTP ${response.status}`);
        }

        // read the reply safely (does not crash if n8n sends something unexpected)
        const raw = await response.text();
        let result;
        try {
            result = JSON.parse(raw);
        } catch (e) {
            console.log("n8n did not return valid JSON:", raw.slice(0, 200));
            await message.reply(FALLBACK_REPLY);
            return;
        }

        if (!(result.success && (result.reply || result.audio))) {
            console.log("n8n returned no valid reply:", result);
            await message.reply(FALLBACK_REPLY);
            return;
        }

        // voice reply: only if the user sent a voice note and n8n sent audio back
        if (isVoice && result.audio) {
            try {
                const voice = new MessageMedia(
                    "audio/ogg; codecs=opus",
                    result.audio,
                    "reply.ogg"
                );
                await client.sendMessage(message.from, voice, { sendAudioAsVoice: true });
                console.log("Voice reply sent successfully.");
                return;
            } catch (e) {
                console.error("Voice reply failed, sending text instead:", e.message);
            }
        }

        // text reply (also the fallback if the voice reply fails)
        if (result.reply) {
            await message.reply(result.reply);
            console.log("Reply sent successfully.");
        }
    } catch (error) {
        console.error("Message processing failed:", error.message);
        try {
            await message.reply(FALLBACK_REPLY);
        } catch (e) {
            console.error("Could not send fallback reply:", e.message);
        }
    } finally {
        if (typingTimer) clearInterval(typingTimer);
        if (chat) chat.clearState().catch(() => {});
    }
});

const QR_PAGE_PASSWORD = process.env.QR_PAGE_PASSWORD;

if (!QR_PAGE_PASSWORD) {
    throw new Error("QR_PAGE_PASSWORD is missing from Railway Variables");
}

const qrServer = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || "";
    const encoded = auth.startsWith("Basic ") ? auth.slice(6) : "";

    let credentials = "";

    try {
        credentials = Buffer.from(encoded, "base64").toString("utf8");
    } catch (error) {
        credentials = "";
    }

    if (credentials !== `admin:${QR_PAGE_PASSWORD}`) {
        res.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="WhatsApp QR"',
            "Content-Type": "text/plain"
        });
        return res.end("Password required");
    }

    if (req.url === "/qr.png") {
        if (!latestQr) {
            res.writeHead(503, { "Content-Type": "text/plain" });
            return res.end("QR code is not ready yet. Refresh this page.");
        }

        try {
            const image = await QRCode.toBuffer(latestQr, {
                type: "png",
                width: 500,
                margin: 3
            });

            res.writeHead(200, {
                "Content-Type": "image/png",
                "Cache-Control": "no-store"
            });

            return res.end(image);
        } catch (error) {
            console.error("QR image generation failed:", error.message);
            res.writeHead(500);
            return res.end("Could not generate QR image");
        }
    }

    if (req.url === "/" || req.url.startsWith("/?")) {
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        });

        return res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Eocean WhatsApp QR</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 30px;
                    }
                    img {
                        width: 100%;
                        max-width: 500px;
                    }
                </style>
            </head>
            <body>
                <h2>Connect Eocean WhatsApp</h2>
                <p>Open WhatsApp on your phone and scan this QR code.</p>
                <img id="qr" src="/qr.png">
                <p id="status">Waiting for QR code...</p>
                <script>
                    setInterval(() => {
                        document.getElementById("qr").src =
                            "/qr.png?t=" + Date.now();
                    }, 5000);
                </script>
            </body>
            </html>
        `);
    }

    res.writeHead(404);
    res.end("Not found");
});

qrServer.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("Protected WhatsApp QR webpage is running.");
});

client.initialize();
require("dotenv").config();

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

if (!WEBHOOK_URL) {
    throw new Error("N8N_WEBHOOK_URL is missing from .env");
}

const FALLBACK_REPLY = "Sorry, something went wrong on our side. Please try again in a moment 🙏";

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.WHATSAPP_SESSION_NAME || "eocean-customer-assistant"
    }),
    puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

client.on("qr", (qr) => {
    console.log("Scan this QR code using your test WhatsApp account:");
    qrcode.generate(qr, { small: true });
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

client.initialize();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const axios = require("axios");
const moment = require("moment");

const app = express();
app.use(express.json());

// ===========================
// CONFIG RAILWAY & BOT
// ===========================
const BOT_TOKEN = process.env.BOT_TOKEN || "7689769594:AAGAkbi4EC1YuOsAUe5QxolzCOv2JFCUY10";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "YPTMoA2jSbKQbb4s6YDGOk1s";
const OWNER_ID = 6336062767;
const CHANNEL_USERNAME = "@zamshtml";

const URL = "https://" + (process.env.RAILWAY_PUBLIC_DOMAIN || ""); // auto domain Railway
const PORT = process.env.PORT || 3000;

// ===========================
// BOT INITIALIZATION (WEBHOOK MODE FOR RAILWAY)
// ===========================

let bot;

if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    // Running on Railway → use webhook
    bot = new TelegramBot(BOT_TOKEN, { webHook: true });
    bot.setWebHook(`${URL}/bot${BOT_TOKEN}`);
    console.log("🚀 Bot running in WEBHOOK mode on Railway");
} else {
    // Running locally → use polling
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log("🤖 Bot running in POLLING mode (local)");
}

// Handle webhook
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ===========================
// FILE DATABASE
// ===========================
const USERS_FILE = "./users.json";
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

function getAllUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE));
}
function addUser(chatId) {
    const users = getAllUsers();
    if (!users.includes(chatId)) {
        users.push(chatId);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users));
    }
}

// ===========================
// JOIN CHECK
// ===========================
async function checkJoin(chatId) {
    try {
        const r = await bot.getChatMember(CHANNEL_USERNAME, chatId);
        return ["member", "creator", "administrator"].includes(r.status);
    } catch {
        return false;
    }
}

async function requireJoin(chatId) {
    const ok = await checkJoin(chatId);
    if (!ok) {
        await bot.sendMessage(
            chatId,
            `
⚠️ Kamu harus join channel terlebih dahulu!

👉 Join Channel: ${CHANNEL_USERNAME}
Ketik /start setelah join.
`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📡 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}` }]
                    ]
                }
            }
        );
        return false;
    }
    return true;
}

// ===========================
// START MENU
// ===========================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || "User";

    if (!(await requireJoin(chatId))) return;

    addUser(chatId);

    bot.sendMessage(
        chatId,
        `
<b>💠 ZamsDeploy Bot — Railway Ready</b>
━━━━━━━━━━━━━━━━━━
👋 Hai <b>@${username}</b>!

<b>📌 Fitur:</b>
🚀 Deploy Website ke Vercel  
🔒 Encrypt File HTML  
🔓 Decrypt File HTML  
📢 Broadcast (Owner)

<b>Pilih menu di bawah 👇</b>
━━━━━━━━━━━━━━━━━━
`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Deploy Web", callback_data: "open_deploy" }],
                    [
                        { text: "🔒 Encrypt HTML", callback_data: "open_encrypt" },
                        { text: "🔓 Decrypt HTML", callback_data: "open_decrypt" }
                    ],
                    [
                        { text: "📡 Channel", url: "https://t.me/zamshtml" },
                        { text: "👑 Owner", url: "https://t.me/zamsXd" }
                    ]
                ]
            }
        }
    );
});

// ===========================
// CALLBACK HANDLER
// ===========================
let userSessions = {};

bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;

    if (q.data === "open_deploy") {
        userSessions[chatId] = { mode: "deploy_file" };
        return bot.sendMessage(chatId, "<b>🚀 Kirim file .html untuk deploy</b>", { parse_mode: "HTML" });
    }

    if (q.data === "open_encrypt") {
        userSessions[chatId] = { mode: "encrypt" };
        return bot.sendMessage(chatId, "🔒 Kirim file .html untuk dienkripsi");
    }

    if (q.data === "open_decrypt") {
        userSessions[chatId] = { mode: "decrypt" };
        return bot.sendMessage(chatId, "🔓 Kirim file .html terenkripsi");
    }
});

// ===========================
// COMMAND /deploy
// ===========================
bot.onText(/\/deploy/, async (msg) => {
    const chatId = msg.chat.id;

    if (!(await requireJoin(chatId))) return;

    userSessions[chatId] = { mode: "deploy_file" };
    bot.sendMessage(chatId, "🚀 Kirim file .html untuk deploy");
});

// ===========================
// FILE HANDLING
// ===========================
bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const fileName = msg.document.file_name;
    const fileId = msg.document.file_id;

    if (!(await requireJoin(chatId))) return;

    const session = userSessions[chatId];
    const fileUrl = await bot.getFileLink(fileId);
    const buffer = (await axios.get(fileUrl, { responseType: "arraybuffer" })).data;

    if (!session) return;

    // -------- ENCRYPT --------
    if (session.mode === "encrypt") {
        if (!fileName.endsWith(".html")) return bot.sendMessage(chatId, "❌ File harus .html");

        const base = Buffer.from(buffer).toString("base64");
        const out = `encrypted_${Date.now()}.html`;

        const wrap = `
<!DOCTYPE html>
<html>
<body>
<script>document.write(atob("${base}"));</script>
</body>
</html>`;

        fs.writeFileSync(out, wrap);

        await bot.sendDocument(chatId, out, { caption: "🔒 Enkripsi selesai" });
        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // -------- DECRYPT --------
    if (session.mode === "decrypt") {
        const text = buffer.toString();
        const match = text.match(/atob\("(.+)"\)/);
        if (!match) return bot.sendMessage(chatId, "❌ File tidak valid!");

        const html = Buffer.from(match[1], "base64").toString("utf8");
        const out = `decrypted_${Date.now()}.html`;

        fs.writeFileSync(out, html);
        await bot.sendDocument(chatId, out, { caption: "🔓 Dekripsi selesai" });
        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // -------- DEPLOY --------
    if (session.mode === "deploy_file") {
        if (!fileName.endsWith(".html")) return bot.sendMessage(chatId, "⚠️ File harus .html!");

        const save = `./${fileName}`;
        fs.writeFileSync(save, buffer);

        userSessions[chatId] = { mode: "deploy_domain", file: save };

        return bot.sendMessage(chatId, "📝 Masukkan nama domain (tanpa .vercel.app)");
    }
});

// ===========================
// DOMAIN INPUT
// ===========================
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.mode !== "deploy_domain") return;

    const domain = msg.text.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(domain)) {
        return bot.sendMessage(chatId, "⚠️ Domain tidak valid!");
    }

    bot.sendMessage(chatId, "🚀 Deploying ke Vercel...");

    try {
        const html = fs.readFileSync(session.file, "utf8");
        const base64 = Buffer.from(html).toString("base64");

        await axios.post(
            "https://api.vercel.com/v13/deployments",
            {
                name: domain,
                files: [{ file: "index.html", data: base64, encoding: "base64" }],
                target: "production"
            },
            { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
        );

        const url = `https://${domain}.vercel.app`;

        bot.sendMessage(chatId, `✅ Deploy berhasil!\n🌐 ${url}`);
        bot.sendMessage(OWNER_ID, `📢 User Deploy:\nID: ${chatId}\n🌐 ${url}`);

    } catch (err) {
        bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }

    fs.unlinkSync(session.file);
    delete userSessions[chatId];
});

// ===========================
// BROADCAST
// ===========================
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return;

    const text = match[1];
    const users = getAllUsers();

    bot.sendMessage(msg.chat.id, `📢 Mengirim ke ${users.length} user...`);

    for (const id of users) {
        bot.sendMessage(id, `<b>📢 Broadcast:</b>\n\n${text}`, { parse_mode: "HTML" }).catch(() => {});
    }

    bot.sendMessage(msg.chat.id, "✔️ Broadcast selesai.");
});

// ===========================
// RAILWAY START
// ===========================

app.get("/", (req, res) => {
    res.send("ZamsDeploy Bot — Running on Railway");
});

app.listen(PORT, () => {
    console.log(`✔️ Server running on port ${PORT}`);
});

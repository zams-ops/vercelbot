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

const URL = "https://" + (process.env.RAILWAY_PUBLIC_DOMAIN || ""); 
const PORT = process.env.PORT || 3000;

// ===========================
// BOT INITIALIZATION (WEBHOOK MODE FOR RAILWAY)
// ===========================
let bot;

if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    bot = new TelegramBot(BOT_TOKEN, { webHook: true });
    bot.setWebHook(`${URL}/bot${BOT_TOKEN}`);
    console.log("🚀 Bot running in WEBHOOK mode on Railway");
} else {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log("🤖 Bot running in POLLING mode (local)");
}

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
// STATS DATABASE
// ===========================
const STATS_DIR = process.env.STATS_DIR || "/mnt/data";
const STATS_FILE = `${STATS_DIR}/stats.json`;

if (!fs.existsSync(STATS_DIR)) {
    fs.mkdirSync(STATS_DIR, { recursive: true });
}

if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(
        STATS_FILE,
        JSON.stringify({ deploy: 0, encrypt: 0, decrypt: 0, startTime: Date.now() })
    );
}

function getStats() {
    return JSON.parse(fs.readFileSync(STATS_FILE));
}
function saveStats(data) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data));
}

let stats = getStats();

if (!stats.startTime) {
    stats.startTime = Date.now();
    saveStats(stats);
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
<b>💠 ZamsDeploy Bot </b>
━━━━━━━━━━━━━━━━━━
👋 Hai <b>@${username}</b>!

<b>📌 Fitur:</b>
🚀 Deploy Website  
🔒 Encrypt HTML  
🔓 Decrypt HTML  
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
        userSessions[chatId] = { mode: "deploy_wait_file" };
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
// /deploy COMMAND
// ===========================
bot.onText(/\/deploy/, async (msg) => {
    const chatId = msg.chat.id;

    if (!(await requireJoin(chatId))) return;

    userSessions[chatId] = { mode: "deploy_wait_file" };
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
    if (!session) return;

    const fileUrl = await bot.getFileLink(fileId);
    const buffer = (await axios.get(fileUrl, { responseType: "arraybuffer" })).data;

    // ---- ENCRYPT ----
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

        let st = getStats();
        st.encrypt += 1;
        saveStats(st);

        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // ---- DECRYPT ----
    if (session.mode === "decrypt") {
        const text = buffer.toString();
        const match = text.match(/atob\("(.+)"\)/);
        if (!match) return bot.sendMessage(chatId, "❌ File tidak valid!");

        const html = Buffer.from(match[1], "base64").toString("utf8");
        const out = `decrypted_${Date.now()}.html`;

        fs.writeFileSync(out, html);
        await bot.sendDocument(chatId, out, { caption: "🔓 Dekripsi selesai" });

        let st = getStats();
        st.decrypt += 1;
        saveStats(st);

        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // ---- DEPLOY (FIXED) ----
    if (session.mode === "deploy_wait_file") {
        if (!fileName.endsWith(".html"))
            return bot.sendMessage(chatId, "⚠️ File harus .html");

        const savePath = `./${Date.now()}_${fileName}`;
        fs.writeFileSync(savePath, buffer);

        userSessions[chatId] = {
            mode: "deploy_wait_domain",
            file: savePath
        };

        return bot.sendMessage(chatId, "📝 Masukkan domain (contoh: webkeren123)");
    }
});

// ===========================
// DOMAIN HANDLER
// ===========================
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (!session || session.mode !== "deploy_wait_domain") return;
    if (!msg.text || msg.text.startsWith("/")) return;

    const domain = msg.text.trim().toLowerCase();

    if (!/^[a-z0-9-]+$/.test(domain)) {
        return bot.sendMessage(chatId, "⚠️ Domain hanya boleh huruf, angka, dan '-'.");
    }

    bot.sendMessage(chatId, "🚀 Deploying...");

    try {
        const html = fs.readFileSync(session.file, "utf-8");
        const base64 = Buffer.from(html).toString("base64");

        await axios.post(
            "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1",
            {
                name: domain,
                files: [{ file: "index.html", data: base64, encoding: "base64" }],
                target: "production"
            },
            { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
        );

        const link = `https://${domain}.vercel.app`;

        bot.sendMessage(chatId, `✅ Deploy Sukses!\n🌐 ${link}`);

        bot.sendMessage(
            OWNER_ID,
            `📢 Deploy Baru!\nUser: <code>${chatId}</code>\n🌐 ${link}`,
            { parse_mode: "HTML" }
        );

        let st = getStats();
        st.deploy += 1;
        saveStats(st);

    } catch (e) {
        bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }

    fs.unlinkSync(session.file);
    delete userSessions[chatId];
});

// ===========================
// /broadcast
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
// /stats
// ===========================
bot.onText(/\/stats/, async (msg) => {
    if (msg.chat.id !== OWNER_ID) return;

    const users = getAllUsers().length;
    const st = getStats();

    const uptimeMs = Date.now() - st.startTime;
    const uptime = moment.utc(uptimeMs).format("HH:mm:ss");

    return bot.sendMessage(
        msg.chat.id,
        `
<b>📊 ZamsDeploy Bot — Statistics</b>
━━━━━━━━━━━━━━━━━━
👤 Total User: <b>${users}</b>

🚀 Deploy: <b>${st.deploy}</b>
🔒 Encrypt: <b>${st.encrypt}</b>
🔓 Decrypt: <b>${st.decrypt}</b>

⏳ Uptime: <b>${uptime}</b>
🕒 Server Time: <b>${moment().format("YYYY-MM-DD HH:mm:ss")}</b>
━━━━━━━━━━━━━━━━━━
        `,
        { parse_mode: "HTML" }
    );
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

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const axios = require("axios");
const moment = require("moment");

// TOKEN & CONFIG
const BOT_TOKEN = "7689769594:AAGAkbi4EC1YuOsAUe5QxolzCOv2JFCUY10";
const VERCEL_TOKEN = "YPTMoA2jSbKQbb4s6YDGOk1s";
const OWNER_ID = 6336062767;
const CHANNEL_USERNAME = "@zamshtml";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let userSessions = {};

// FILE USERS
const USERS_FILE = "./users.json";
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

function getAllUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE));
}
function addUser(chatId) {
    let users = getAllUsers();
    if (!users.includes(chatId)) {
        users.push(chatId);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users));
    }
}

// JOIN CHECK
async function checkJoin(chatId) {
    try {
        const res = await bot.getChatMember(CHANNEL_USERNAME, chatId);
        return ["member", "administrator", "creator"].includes(res.status);
    } catch (err) {
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
Ketik /start untuk verifikasi.
`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "📡 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace("@", "")}` }]]
                }
            }
        );
        return false;
    }
    return true;
}

// START MENU
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || "User";

    if (!(await requireJoin(chatId))) return;

    addUser(chatId);

    const startMsg = `
<b>💠 ZamsDeploy Bot — Premium UI</b>
━━━━━━━━━━━━━━━━━━
👋 Hai <b>@${username}</b>!

<b>📌 Fitur:</b>
🚀 Deploy Website ke Vercel
🔒 Encrypt File HTML
🔓 Decrypt File HTML
📢 Broadcast (Owner)

<b>Gunakan tombol di bawah supaya lebih cepat 👇</b>
━━━━━━━━━━━━━━━━━━
`;

    bot.sendMessage(chatId, startMsg, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "🚀 Deploy Web", callback_data: "open_deploy" }
                ],
                [
                    { text: "🔒 Encrypt HTML", callback_data: "open_encrypt" },
                    { text: "🔓 Decrypt HTML", callback_data: "open_decrypt" }
                ],
                [
                    { text: "📡 Channel", url: "https://t.me/zamsch" },
                    { text: "👑 Owner", url: "https://t.me/zamsXd" }
                ]
            ]
        }
    });
});

// CALLBACK MENU
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    if (query.data === "open_deploy") {
        userSessions[chatId] = { mode: "deploy_wait_file" };
        return bot.sendMessage(
            chatId,
            `
<b>🚀 DEPLOY MODE AKTIF</b>
━━━━━━━━━━━━━━━━━━
Kirim file <code>.html</code> untuk di-deploy.
`,
            { parse_mode: "HTML" }
        );
    }

    if (query.data === "open_encrypt") {
        userSessions[chatId] = { mode: "encrypt" };
        return bot.sendMessage(chatId, "<b>🔒 ENCRYPT MODE</b>\nKirim file .html untuk dienkripsi.", { parse_mode: "HTML" });
    }

    if (query.data === "open_decrypt") {
        userSessions[chatId] = { mode: "decrypt" };
        return bot.sendMessage(chatId, "<b>🔓 DECRYPT MODE</b>\nKirim file .html terenkripsi.", { parse_mode: "HTML" });
    }
});

// /deploy COMMAND
bot.onText(/\/deploy/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireJoin(chatId))) return;

    userSessions[chatId] = { mode: "deploy_wait_file" };

    bot.sendMessage(
        chatId,
        `
<b>🚀 DEPLOY MODE</b>
━━━━━━━━━━━━━━━━━━
Kirim file <code>.html</code> yang ingin kamu deploy.
`,
        { parse_mode: "HTML" }
    );
});

// FILE HANDLER
bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name;

    if (!(await requireJoin(chatId))) return;

    let session = userSessions[chatId];
    const fileUrl = await bot.getFileLink(fileId);
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });

    // ========== ENCRYPT MODE ==========
    if (session?.mode === "encrypt") {
        if (!fileName.endsWith(".html")) {
            return bot.sendMessage(chatId, "❌ File harus .html");
        }

        const base64Data = Buffer.from(response.data).toString("base64");
        const title = fileName.replace(".html", "");

        const wrapped = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${title}</title></head>
<body>
<script>document.write(atob("${base64Data}"));</script>
</body>
</html>`;

        const out = `encrypted_${Date.now()}.html`;
        fs.writeFileSync(out, wrapped);

        await bot.sendDocument(chatId, out, { caption: "✔️ Enkripsi Berhasil" });
        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // ========== DECRYPT MODE ==========
    if (session?.mode === "decrypt") {
        const content = response.data.toString();
        const match = content.match(/atob\("(.+)"\)/);

        if (!match) return bot.sendMessage(chatId, "❌ File tidak valid!");

        const decoded = Buffer.from(match[1], "base64").toString("utf-8");
        const out = `decrypted_${Date.now()}.html`;

        fs.writeFileSync(out, decoded);
        await bot.sendDocument(chatId, out, { caption: "✔️ Dekripsi Berhasil" });
        fs.unlinkSync(out);
        delete userSessions[chatId];
        return;
    }

    // ========== DEPLOY MODE ==========
    if (session?.mode === "deploy_wait_file") {
        if (!fileName.endsWith(".html"))
            return bot.sendMessage(chatId, "⚠️ File harus .html");

        const path = `./${fileName}`;
        fs.writeFileSync(path, response.data);

        userSessions[chatId] = {
            mode: "deploy_wait_domain",
            file: path
        };

        return bot.sendMessage(chatId, "📝 Masukkan domain (contoh: webkeren123)");
    }
});

// DOMAIN HANDLER
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

    } catch (e) {
        bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }

    fs.unlinkSync(session.file);
    delete userSessions[chatId];
});

// BROADCAST
bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (msg.chat.id !== OWNER_ID) return bot.sendMessage(msg.chat.id, "❌ Tidak diizinkan!");

    const text = match[1];
    const users = getAllUsers();

    bot.sendMessage(msg.chat.id, `📢 Mengirim ke ${users.length} user...`);

    for (let id of users) {
        await bot.sendMessage(id, `<b>📢 Broadcast:</b>\n\n${text}`, { parse_mode: "HTML" }).catch(() => {});
    }

    bot.sendMessage(msg.chat.id, "✔️ Broadcast selesai.");
});

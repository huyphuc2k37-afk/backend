/**
 * Telegram Bot integration for VStory admin notifications.
 *
 * Sends deposit/withdrawal alerts with inline approve/reject buttons.
 * Listens for callback_query updates via polling to handle button presses.
 * Uses Node.js https module for compatibility with all Node versions.
 */

import https from "https";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// ─── Helpers ─────────────────────────────────────
const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

function httpsPost(url: string, body: Record<string, any>): Promise<any> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", (err) => {
      console.error("[Telegram] https request error:", err.message);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on("error", (err) => {
      console.error("[Telegram] https get error:", err.message);
      resolve(null);
    });
  });
}

async function tgPost(method: string, body: Record<string, any>) {
  try {
    console.log(`[Telegram] Calling ${method}...`);
    const result = await httpsPost(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, body);
    console.log(`[Telegram] ${method} response:`, JSON.stringify(result).slice(0, 200));
    return result;
  } catch (err) {
    console.error(`[Telegram] ${method} failed:`, err);
    return null;
  }
}

// ─── Send message with inline keyboard ───────────
export async function sendTelegramMessage(
  text: string,
  inlineKeyboard?: { text: string; callback_data: string }[][]
) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Telegram] sendTelegramMessage skipped: no token/chatId", { BOT_TOKEN: BOT_TOKEN ? "set" : "empty", CHAT_ID: CHAT_ID ? "set" : "empty" });
    return;
  }
  const body: Record<string, any> = {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
  };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  return tgPost("sendMessage", body);
}

// ─── Edit message (remove buttons after action) ──
async function editMessageText(chatId: string | number, messageId: number, text: string) {
  return tgPost("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  });
}

// ─── Answer callback query ───────────────────────
async function answerCallbackQuery(callbackQueryId: string, text: string) {
  return tgPost("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: true,
  });
}

// ─── Notification senders ────────────────────────
export async function notifyNewDeposit(deposit: {
  id: string;
  amount: number;
  coins: number;
  method: string;
  transferCode: string;
  transferNote?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
}) {
  console.log("[Telegram] notifyNewDeposit called for deposit:", deposit.id);
  const userName = deposit.user?.name || "N/A";
  const userEmail = deposit.user?.email || "N/A";
  const methodLabel = deposit.method === "zalopay" ? "ZaloPay" : "Agribank";

  const text =
    `💰 <b>YÊU CẦU NẠP XU MỚI</b>\n\n` +
    `👤 <b>${userName}</b> (${userEmail})\n` +
    `💵 Số tiền: <b>${fmtVND(deposit.amount)}đ</b>\n` +
    `🪙 Xu: <b>${fmtVND(deposit.coins)}</b>\n` +
    `🏦 Qua: <b>${methodLabel}</b>\n` +
    `🔑 Mã GD: <code>${deposit.transferCode}</code>\n` +
    (deposit.transferNote ? `📝 Nội dung CK: <code>${deposit.transferNote}</code>\n` : "") +
    `\n🆔 ID: <code>${deposit.id}</code>`;

  await sendTelegramMessage(text, [
    [
      { text: "✅ Duyệt", callback_data: `approve_deposit_${deposit.id}` },
      { text: "❌ Từ chối", callback_data: `reject_deposit_${deposit.id}` },
    ],
  ]);
}

export async function notifyNewWithdrawal(withdrawal: {
  id: string;
  amount: number;
  moneyAmount: number;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  user?: { name?: string | null; email?: string | null } | null;
}) {
  const userName = withdrawal.user?.name || "N/A";
  const userEmail = withdrawal.user?.email || "N/A";

  const text =
    `🏧 <b>YÊU CẦU RÚT TIỀN MỚI</b>\n\n` +
    `👤 <b>${userName}</b> (${userEmail})\n` +
    `🪙 Xu rút: <b>${fmtVND(withdrawal.amount)}</b>\n` +
    `💵 Tiền: <b>${fmtVND(withdrawal.moneyAmount)}đ</b>\n` +
    `🏦 Ngân hàng: <b>${withdrawal.bankName}</b>\n` +
    `💳 STK: <code>${withdrawal.bankAccount}</code>\n` +
    `👤 Chủ TK: <b>${withdrawal.bankHolder}</b>\n` +
    `\n🆔 ID: <code>${withdrawal.id}</code>`;

  await sendTelegramMessage(text, [
    [
      { text: "✅ Duyệt", callback_data: `approve_withdraw_${withdrawal.id}` },
      { text: "❌ Từ chối", callback_data: `reject_withdraw_${withdrawal.id}` },
    ],
  ]);
}

// ─── Safe notification creator (reusable) ────────
async function createNotificationSafe(args: Parameters<typeof prisma.notification.create>[0]) {
  try {
    await prisma.notification.create(args);
  } catch (err) {
    console.error("[Telegram] notification.create failed:", err);
  }
}

// ─── Process callback from Telegram button click ─
async function handleCallback(callbackQueryId: string, data: string, chatId: number, messageId: number) {
  // Parse action: approve_deposit_<id>, reject_deposit_<id>, approve_withdraw_<id>, reject_withdraw_<id>
  const match = data.match(/^(approve|reject)_(deposit|withdraw)_(.+)$/);
  if (!match) {
    await answerCallbackQuery(callbackQueryId, "❓ Lệnh không hợp lệ");
    return;
  }

  const [, action, type, id] = match;

  try {
    if (type === "deposit") {
      const deposit = await prisma.deposit.findUnique({ where: { id } });
      if (!deposit) {
        await answerCallbackQuery(callbackQueryId, "❌ Không tìm thấy giao dịch nạp xu");
        return;
      }
      if (deposit.status !== "pending") {
        await answerCallbackQuery(callbackQueryId, `⚠️ Giao dịch đã được xử lý (${deposit.status})`);
        await editMessageText(chatId, messageId,
          `💰 <b>NẠP XU — ĐÃ XỬ LÝ</b>\n\nTrạng thái: <b>${deposit.status}</b>\n🆔 <code>${id}</code>`
        );
        return;
      }

      if (action === "approve") {
        await prisma.$transaction([
          prisma.deposit.update({
            where: { id },
            data: { status: "approved", adminNote: "Duyệt qua Telegram" },
          }),
          prisma.user.update({
            where: { id: deposit.userId },
            data: { coinBalance: { increment: deposit.coins } },
          }),
        ]);

        await createNotificationSafe({
          data: {
            userId: deposit.userId,
            type: "wallet",
            title: "Nạp xu thành công",
            message: `Yêu cầu nạp ${fmtVND(deposit.coins)} xu (${fmtVND(deposit.amount)}đ) đã được duyệt.`,
            link: "/wallet",
          },
        });

        await answerCallbackQuery(callbackQueryId, `✅ Đã duyệt nạp ${fmtVND(deposit.coins)} xu`);
        await editMessageText(chatId, messageId,
          `💰 <b>NẠP XU — ĐÃ DUYỆT ✅</b>\n\n` +
          `💵 ${fmtVND(deposit.amount)}đ → ${fmtVND(deposit.coins)} xu\n` +
          `🆔 <code>${id}</code>`
        );
      } else {
        await prisma.deposit.update({
          where: { id },
          data: { status: "rejected", adminNote: "Từ chối qua Telegram" },
        });

        await createNotificationSafe({
          data: {
            userId: deposit.userId,
            type: "wallet",
            title: "Yêu cầu nạp xu bị từ chối",
            message: `Yêu cầu nạp ${fmtVND(deposit.coins)} xu (${fmtVND(deposit.amount)}đ) đã bị từ chối.`,
            link: "/wallet",
          },
        });

        await answerCallbackQuery(callbackQueryId, `❌ Đã từ chối nạp xu`);
        await editMessageText(chatId, messageId,
          `💰 <b>NẠP XU — ĐÃ TỪ CHỐI ❌</b>\n\n` +
          `💵 ${fmtVND(deposit.amount)}đ → ${fmtVND(deposit.coins)} xu\n` +
          `🆔 <code>${id}</code>`
        );
      }
    } else if (type === "withdraw") {
      const withdrawal = await prisma.withdrawal.findUnique({ where: { id } });
      if (!withdrawal) {
        await answerCallbackQuery(callbackQueryId, "❌ Không tìm thấy yêu cầu rút tiền");
        return;
      }
      if (withdrawal.status !== "pending") {
        await answerCallbackQuery(callbackQueryId, `⚠️ Yêu cầu đã được xử lý (${withdrawal.status})`);
        await editMessageText(chatId, messageId,
          `🏧 <b>RÚT TIỀN — ĐÃ XỬ LÝ</b>\n\nTrạng thái: <b>${withdrawal.status}</b>\n🆔 <code>${id}</code>`
        );
        return;
      }

      if (action === "approve") {
        await prisma.$transaction([
          prisma.withdrawal.update({
            where: { id },
            data: { status: "approved", adminNote: "Duyệt qua Telegram" },
          }),
        ]);

        await createNotificationSafe({
          data: {
            userId: withdrawal.userId,
            type: "wallet",
            title: "Yêu cầu rút tiền đã được duyệt",
            message: `Yêu cầu rút ${fmtVND(withdrawal.amount)} xu (${fmtVND(withdrawal.moneyAmount)}đ) đã được duyệt.`,
            link: "/write/withdraw",
          },
        });

        await answerCallbackQuery(callbackQueryId, `✅ Đã duyệt rút ${fmtVND(withdrawal.moneyAmount)}đ`);
        await editMessageText(chatId, messageId,
          `🏧 <b>RÚT TIỀN — ĐÃ DUYỆT ✅</b>\n\n` +
          `💵 ${fmtVND(withdrawal.amount)} xu → ${fmtVND(withdrawal.moneyAmount)}đ\n` +
          `🏦 ${withdrawal.bankName} — ${withdrawal.bankAccount}\n` +
          `🆔 <code>${id}</code>`
        );
      } else {
        // Từ chối → hoàn xu
        await prisma.$transaction([
          prisma.withdrawal.update({
            where: { id },
            data: { status: "rejected", adminNote: "Từ chối qua Telegram" },
          }),
          prisma.user.update({
            where: { id: withdrawal.userId },
            data: { coinBalance: { increment: withdrawal.amount } },
          }),
        ]);

        await createNotificationSafe({
          data: {
            userId: withdrawal.userId,
            type: "wallet",
            title: "Yêu cầu rút tiền bị từ chối",
            message: `Yêu cầu rút ${fmtVND(withdrawal.amount)} xu (${fmtVND(withdrawal.moneyAmount)}đ) đã bị từ chối.`,
            link: "/write/withdraw",
          },
        });

        await answerCallbackQuery(callbackQueryId, `❌ Đã từ chối rút tiền, hoàn xu`);
        await editMessageText(chatId, messageId,
          `🏧 <b>RÚT TIỀN — ĐÃ TỪ CHỐI ❌</b>\n\n` +
          `💵 ${fmtVND(withdrawal.amount)} xu → hoàn lại\n` +
          `🆔 <code>${id}</code>`
        );
      }
    }
  } catch (err) {
    console.error("[Telegram] handleCallback error:", err);
    await answerCallbackQuery(callbackQueryId, "⚠️ Có lỗi xảy ra, vui lòng thử trên web");
  }
}

// ─── Polling loop ────────────────────────────────
let pollingActive = false;
let lastUpdateId = 0;

export function startTelegramPolling() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Telegram] Bot token or chat ID not configured, skipping polling.");
    return;
  }

  if (pollingActive) return;
  pollingActive = true;
  console.log("[Telegram] Bot polling started.");

  const poll = async () => {
    while (pollingActive) {
      try {
        const data: any = await httpsGet(
          `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["callback_query"]`
        );

        if (data && data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = update.update_id;

            if (update.callback_query) {
              const cq = update.callback_query;
              const chatId = cq.message?.chat?.id;
              const messageId = cq.message?.message_id;

              if (chatId && messageId && cq.data) {
                // Fire and forget — don't block polling
                handleCallback(cq.id, cq.data, chatId, messageId).catch((err) =>
                  console.error("[Telegram] callback handler error:", err)
                );
              }
            }
          }
        }
      } catch (err: any) {
        console.error("[Telegram] Polling error:", err?.message || err);
        // Wait a bit before retrying on real errors
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };

  poll();
}

export function stopTelegramPolling() {
  pollingActive = false;
}

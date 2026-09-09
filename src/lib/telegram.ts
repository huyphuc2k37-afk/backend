/**
 * Telegram Bot integration for VStory admin notifications.
 *
 * Sends deposit/withdrawal alerts with inline approve/reject buttons.
 * Listens for callback_query updates via polling to handle button presses.
 * Uses Node.js https module for compatibility with all Node versions.
 */

import https from "https";
import prisma from "./prisma";

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();

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
        try {
          const parsed = JSON.parse(data);
          // Surface 4xx/5xx so caller can react (esp. 409 getUpdates conflict)
          if (res.statusCode && res.statusCode >= 400) {
            parsed._httpStatus = res.statusCode;
          }
          resolve(parsed);
        } catch {
          resolve({ ok: false, _httpStatus: res.statusCode });
        }
      });
    });
    req.on("error", (err) => {
      console.error("[Telegram] https request error:", err.message);
      resolve(null);
    });
    // Telegram will close long-poll early; set a sane timeout
    req.setTimeout(60_000, () => {
      req.destroy(new Error("telegram_post_timeout"));
    });
    req.write(payload);
    req.end();
  });
}

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            parsed._httpStatus = res.statusCode;
          }
          resolve(parsed);
        } catch {
          resolve({ ok: false, _httpStatus: res.statusCode });
        }
      });
    });
    req.on("error", (err) => {
      console.error("[Telegram] https get error:", err.message);
      resolve(null);
    });
    req.setTimeout(45_000, () => req.destroy(new Error("telegram_get_timeout")));
  });
}

async function tgPost(method: string, body: Record<string, any>) {
  try {
    const result = await httpsPost(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, body);
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
    return { ok: false, skipped: true, reason: "missing_token_or_chat_id" };
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
  const userName = deposit.user?.name || "N/A";
  const userEmail = deposit.user?.email || "N/A";
  const methodLabel = deposit.method === "zalopay" ? "ZaloPay" : "Eximbank";

  const text =
    `💰 <b>YÊU CẦU NẠP XU MỚI</b>\n\n` +
    `👤 <b>${userName}</b> (${userEmail})\n` +
    `💵 Số tiền: <b>${fmtVND(deposit.amount)}đ</b>\n` +
    `🪙 Xu: <b>${fmtVND(deposit.coins)}</b>\n` +
    `🏦 Qua: <b>${methodLabel}</b>\n` +
    `🔑 Mã GD: <code>${deposit.transferCode}</code>\n` +
    (deposit.transferNote ? `📝 Nội dung CK: <code>${deposit.transferNote}</code>\n` : "") +
    `\n🆔 ID: <code>${deposit.id}</code>`;

  return sendTelegramMessage(text, [
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

// CUID/id pattern: [a-z0-9]{20,32} (Prisma default cuid = 25 chars)
const CUID_PATTERN = /^[a-z0-9]{20,32}$/i;

// ─── Process callback from Telegram button click ─
async function handleCallback(callbackQueryId: string, data: string, chatId: number, messageId: number) {
  // ── Test callbacks ──────────────────────────────────────────────────────────
  if (data === "test_callback_ok" || data === "test_callback_fail") {
    _testCallbackReceived = true;
    _testCallbackData = data;
    _testCallbackTime = Date.now();
    await answerCallbackQuery(callbackQueryId, `✅ Test callback nhận được: ${data}`);
    await editMessageText(chatId, messageId,
      `🧪 <b>TEST THÀNH CÔNG</b>\n\nCallback: <code>${data}</code>\nTime: ${new Date().toISOString()}\n\n✅ Telegram ↔ Railway đang hoạt động!`
    );
    return;
  }

  // Parse action: approve_deposit_<id>, reject_deposit_<id>, approve_withdraw_<id>, reject_withdraw_<id>
  const match = data.match(/^(approve|reject)_(deposit|withdraw)_(.+)$/);
  if (!match) {
    await answerCallbackQuery(callbackQueryId, "❓ Lệnh không hợp lệ");
    return;
  }

  const [, action, type, rawId] = match;

  // Strict id validation: avoid passing junk to Prisma → avoid crashing into the generic catch.
  const id = rawId.trim();
  if (!CUID_PATTERN.test(id)) {
    console.warn(`[Telegram] reject callback — invalid id shape: ${JSON.stringify(rawId)}`);
    await answerCallbackQuery(callbackQueryId, "❌ Mã giao dịch không hợp lệ (id sai định dạng)");
    return;
  }

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
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.deposit.findUnique({ where: { id }, select: { status: true } });
          if (!fresh || fresh.status !== "pending") throw new Error("ALREADY_PROCESSED");
          await tx.deposit.update({
            where: { id },
            data: { status: "approved", adminNote: "Duyệt qua Telegram" },
          });
          await tx.user.update({
            where: { id: deposit.userId },
            data: { coinBalance: { increment: deposit.coins } },
          });
        });

        await createNotificationSafe({
          data: {
            userId: deposit.userId,
            type: "wallet",
            title: "Nạp xu thành công",
            message: `Yêu cầu nạp ${fmtVND(deposit.coins)} xu (${fmtVND(deposit.amount)}đ) đã được duyệt.`,
            link: "/wallet",
          },
        });

        // ── Hoa hồng referral 2% trên nạp xu (same as admin.ts) ──
        try {
          const depositUser = await prisma.user.findUnique({
            where: { id: deposit.userId },
            select: { referredById: true, name: true },
          });
          if (depositUser?.referredById) {
            const referrer = await prisma.user.findUnique({
              where: { id: depositUser.referredById },
              select: { id: true, role: true },
            });
            if (referrer && (referrer.role === "author" || referrer.role === "admin")) {
              const commission = Math.floor(deposit.coins * 0.02);
              if (commission >= 1) {
                await prisma.$transaction([
                  prisma.user.update({
                    where: { id: referrer.id },
                    data: { coinBalance: { increment: commission } },
                  }),
                  prisma.referralEarning.create({
                    data: {
                      type: "deposit_commission",
                      amount: commission,
                      sourceAmount: deposit.coins,
                      rate: 0.02,
                      referrerId: referrer.id,
                      fromUserId: deposit.userId,
                      depositId: deposit.id,
                    },
                  }),
                ]);
                await createNotificationSafe({
                  data: {
                    userId: referrer.id,
                    type: "wallet",
                    title: "Hoa hồng giới thiệu — nạp xu",
                    message: `Người bạn giới thiệu vừa nạp ${fmtVND(deposit.coins)} xu. Bạn nhận được ${fmtVND(commission)} xu hoa hồng (2%).`,
                    link: "/profile",
                  },
                });
              }
            }
          }
        } catch (refErr) {
          console.error("[Telegram] referral commission error (non-blocking):", refErr);
        }

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
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.withdrawal.findUnique({ where: { id }, select: { status: true } });
          if (!fresh || fresh.status !== "pending") throw new Error("ALREADY_PROCESSED");
          await tx.withdrawal.update({
            where: { id },
            data: { status: "approved", adminNote: "Duyệt qua Telegram" },
          });
        });

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
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.withdrawal.findUnique({ where: { id }, select: { status: true } });
          if (!fresh || fresh.status !== "pending") throw new Error("ALREADY_PROCESSED");
          await tx.withdrawal.update({
            where: { id },
            data: { status: "rejected", adminNote: "Từ chối qua Telegram" },
          });
          await tx.user.update({
            where: { id: withdrawal.userId },
            data: { coinBalance: { increment: withdrawal.amount } },
          });
        });

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
  } catch (err: any) {
    console.error(`[Telegram] handleCallback error (action=${action}, type=${type}, id=${id}):`, err?.message || err);

    // Prisma P2025 = "Record not found"
    if (err?.code === "P2025") {
      await answerCallbackQuery(callbackQueryId, "❌ Không tìm thấy giao dịch (đã bị xoá?)");
      return;
    }
    // Prisma P2034 = "Transaction conflict due to race / serialization"
    if (err?.code === "P2034" || err?.message === "ALREADY_PROCESSED") {
      await answerCallbackQuery(callbackQueryId, "⚠️ Giao dịch vừa được xử lý bởi người khác");
      return;
    }
    await answerCallbackQuery(callbackQueryId, "⚠️ Lỗi hệ thống, vui lòng thử lại hoặc dùng trang admin");
  }
}

// ─── Polling loop ────────────────────────────────
// Module-level guard to survive hot-reload / re-evaluate.
// Uses a WeakRef-like stamp so that if the module is re-imported (new instance),
// the OLD instance won't conflict with the NEW one.
let _pollingStamp: string | null = null;
export let pollingActive = false;
export let lastUpdateId = 0;

// Test callback state (used by /api/_debug/telegram/test)
let _testCallbackReceived = false;
let _testCallbackData = "";
let _testCallbackTime = 0;

export function getTestCallbackState() {
  return { received: _testCallbackReceived, data: _testCallbackData, time: _testCallbackTime };
}

export function resetTestCallback() {
  _testCallbackReceived = false;
  _testCallbackData = "";
  _testCallbackTime = 0;
}

export function startTelegramPolling() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[Telegram] Bot token or chat ID not configured, skipping polling.");
    return;
  }

  // Stamp this invocation so multiple calls (e.g. hot-reload) can be distinguished.
  if (pollingActive) {
    console.log("[Telegram] Polling already active (stamp ok), skipping duplicate start.");
    return;
  }
  const stamp = `${Date.now()}_${Math.random()}`;
  _pollingStamp = stamp;
  pollingActive = true;
  console.log(`[Telegram] Bot polling started. stamp=${stamp} pid=${process.pid} chat=${CHAT_ID}`);

  const poll = async () => {
    while (pollingActive && _pollingStamp === stamp) {
      try {
        const data: any = await httpsGet(
          `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["callback_query"]`
        );

        // 409 = another process / old instance is consuming getUpdates — stop this instance's polling.
        if (data && data._httpStatus === 409) {
          console.error("[Telegram] 409 Conflict: another process is polling this bot. Stopping this instance.");
          pollingActive = false;
          return;
        }

        if (data && data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            // Guard: stop processing if stamp changed (module re-evaluated)
            if (_pollingStamp !== stamp) return;

            lastUpdateId = update.update_id;

            if (update.callback_query) {
              const cq = update.callback_query;
              const chatId = cq.message?.chat?.id;
              const messageId = cq.message?.message_id;

              console.log(`[Telegram] callback_query received: data="${cq.data}" from @${cq.from?.username} chat=${chatId} msg=${messageId}`);

              if (chatId && messageId && cq.data) {
                handleCallback(cq.id, cq.data, chatId, messageId).catch((err) =>
                  console.error("[Telegram] callback handler error:", err)
                );
              }
            }
          }
        }
      } catch (err: any) {
        console.error("[Telegram] Polling error:", err?.message || err);
        // Wait before retry on real errors
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };

  poll().catch((err) =>
    console.error("[Telegram] poll() threw:", err?.message || err)
  );
}

export function stopTelegramPolling() {
  pollingActive = false;
  _pollingStamp = null;
}

import { Router, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { AuthRequest, authRequired } from "../middleware/auth";

const router = Router();

/* ─── Helper: get current user from DB ─── */
async function getUser(req: AuthRequest) {
  return prisma.user.findUnique({ where: { email: req.user!.email } });
}

/* ─── Middleware: must be admin/mod OR author ─── */
async function messagingAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });
  if (!["admin", "moderator", "author"].includes(user.role)) {
    return res.status(403).json({ error: "Chức năng nhắn tin chỉ dành cho admin, kiểm duyệt viên và tác giả" });
  }
  (req as any).currentUser = user;
  next();
}

/* ────────────────────────────────────────────────
   GET /api/messages/conversations
   List conversations for current user
   ──────────────────────────────────────────────── */
router.get("/conversations", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId: user.id } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, image: true, role: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    // Count unread per conversation
    const result = conversations.map((conv) => {
      const myParticipant = conv.participants.find((p) => p.userId === user.id);
      const lastReadAt = myParticipant?.lastReadAt || new Date(0);
      const lastMessage = conv.messages[0] || null;
      const otherParticipants = conv.participants
        .filter((p) => p.userId !== user.id)
        .map((p) => p.user);

      return {
        id: conv.id,
        subject: conv.subject,
        storyId: conv.storyId,
        updatedAt: conv.updatedAt,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              content: lastMessage.content.substring(0, 100),
              sender: lastMessage.sender,
              createdAt: lastMessage.createdAt,
            }
          : null,
        otherParticipants,
        hasUnread: lastMessage ? lastMessage.createdAt > lastReadAt : false,
      };
    });

    const total = await prisma.conversation.count({
      where: { participants: { some: { userId: user.id } } },
    });

    res.json({ conversations: result, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────
   GET /api/messages/conversations/:id
   Get messages in a conversation
   ──────────────────────────────────────────────── */
router.get("/conversations/:id", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    // Verify user is a participant
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    });
    if (!participant) return res.status(403).json({ error: "Bạn không thuộc cuộc hội thoại này" });

    const [messages, total, conversation] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sender: { select: { id: true, name: true, image: true, role: true } },
        },
      }),
      prisma.message.count({ where: { conversationId: id } }),
      prisma.conversation.findUnique({
        where: { id },
        include: {
          participants: {
            include: {
              user: { select: { id: true, name: true, image: true, role: true } },
            },
          },
        },
      }),
    ]);

    // Mark as read
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      data: { lastReadAt: new Date() },
    });

    res.json({
      conversation: {
        id: conversation!.id,
        subject: conversation!.subject,
        storyId: conversation!.storyId,
        participants: conversation!.participants.map((p) => p.user),
      },
      messages: messages.reverse(), // oldest first for display
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────
   POST /api/messages/conversations
   Create a new conversation (admin/mod → author only)
   ──────────────────────────────────────────────── */
router.post("/conversations", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;

    // Only admin/mod can start conversations
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).json({ error: "Chỉ admin hoặc kiểm duyệt viên mới có thể bắt đầu hội thoại" });
    }

    const { authorId, subject, message, storyId } = req.body;
    if (!authorId) return res.status(400).json({ error: "Vui lòng chọn tác giả" });
    if (!message || !message.trim()) return res.status(400).json({ error: "Vui lòng nhập nội dung tin nhắn" });

    // Verify target is an author
    const author = await prisma.user.findUnique({ where: { id: authorId } });
    if (!author || author.role !== "author") {
      return res.status(400).json({ error: "Người nhận phải là tác giả" });
    }

    // Check if conversation between these two already exists (optional: merge)
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: user.id } } },
          { participants: { some: { userId: authorId } } },
        ],
        ...(storyId ? { storyId } : {}),
      },
    });

    if (existing) {
      // Add message to existing conversation
      const newMsg = await prisma.message.create({
        data: {
          conversationId: existing.id,
          senderId: user.id,
          content: message.trim(),
        },
        include: {
          sender: { select: { id: true, name: true, image: true, role: true } },
        },
      });
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { updatedAt: new Date(), subject: subject || existing.subject },
      });

      // Send notification to author
      await prisma.notification.create({
        data: {
          userId: authorId,
          type: "system",
          title: "Tin nhắn mới từ " + (user.role === "admin" ? "Admin" : "Kiểm duyệt viên"),
          message: `${user.name}: ${message.trim().substring(0, 100)}`,
          link: "/write/messages",
        },
      }).catch(() => {});

      return res.json({ conversation: existing, message: newMsg });
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        subject: subject?.trim() || null,
        storyId: storyId || null,
        participants: {
          create: [
            { userId: user.id },
            { userId: authorId },
          ],
        },
        messages: {
          create: {
            senderId: user.id,
            content: message.trim(),
          },
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, image: true, role: true } },
          },
        },
        messages: {
          include: {
            sender: { select: { id: true, name: true, image: true, role: true } },
          },
        },
      },
    });

    // Send notification to author
    await prisma.notification.create({
      data: {
        userId: authorId,
        type: "system",
        title: "Tin nhắn mới từ " + (user.role === "admin" ? "Admin" : "Kiểm duyệt viên"),
        message: `${user.name}: ${message.trim().substring(0, 100)}`,
        link: "/write/messages",
      },
    }).catch(() => {});

    res.status(201).json({ conversation });
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────
   POST /api/messages/conversations/:id/reply
   Send a message in an existing conversation
   ──────────────────────────────────────────────── */
router.post("/conversations/:id/reply", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) return res.status(400).json({ error: "Vui lòng nhập nội dung tin nhắn" });

    // Verify user is a participant
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    });
    if (!participant) return res.status(403).json({ error: "Bạn không thuộc cuộc hội thoại này" });

    const newMsg = await prisma.message.create({
      data: {
        conversationId: id,
        senderId: user.id,
        content: message.trim(),
      },
      include: {
        sender: { select: { id: true, name: true, image: true, role: true } },
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Update sender's lastReadAt
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      data: { lastReadAt: new Date() },
    });

    // Notify other participants
    const otherParticipants = await prisma.conversationParticipant.findMany({
      where: { conversationId: id, userId: { not: user.id } },
    });

    const senderLabel = user.role === "admin" ? "Admin" : user.role === "moderator" ? "Kiểm duyệt viên" : user.name;
    const notifLink = ["admin", "moderator"].includes(user.role) ? "/write/messages" : "/mod/messages";

    for (const p of otherParticipants) {
      const targetUser = await prisma.user.findUnique({ where: { id: p.userId }, select: { role: true } });
      const link = targetUser?.role === "author" ? "/write/messages" : (targetUser?.role === "admin" ? "/admin/messages" : "/mod/messages");
      await prisma.notification.create({
        data: {
          userId: p.userId,
          type: "system",
          title: `Tin nhắn mới từ ${senderLabel}`,
          message: `${user.name}: ${message.trim().substring(0, 100)}`,
          link,
        },
      }).catch(() => {});
    }

    res.json({ message: newMsg });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────
   GET /api/messages/unread-count
   Get total unread conversation count
   ──────────────────────────────────────────────── */
router.get("/unread-count", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;

    const participants = await prisma.conversationParticipant.findMany({
      where: { userId: user.id },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    const unread = participants.filter((p) => {
      const lastMsg = p.conversation.messages[0];
      return lastMsg && lastMsg.createdAt > p.lastReadAt && lastMsg.senderId !== user.id;
    }).length;

    res.json({ unread });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ────────────────────────────────────────────────
   GET /api/messages/authors
   List authors for admin/mod to start conversation with
   ──────────────────────────────────────────────── */
router.get("/authors", authRequired, messagingAccess, async (req: AuthRequest, res: Response) => {
  try {
    const user = (req as any).currentUser;
    if (user.role !== "admin" && user.role !== "moderator") {
      return res.status(403).json({ error: "Only admin/mod can list authors" });
    }

    const search = (req.query.search as string) || "";
    const where: any = { role: "author" };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const authors = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, image: true },
      orderBy: { name: "asc" },
      take: 20,
    });

    res.json({ authors });
  } catch (error) {
    console.error("Error fetching authors:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

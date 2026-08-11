import prisma from "../lib/prisma";

type AdminAction =
  | "credit_coins"
  | "deduct_coins"
  | "approve_deposit"
  | "reject_deposit"
  | "approve_withdrawal"
  | "reject_withdrawal"
  | "create_banner"
  | "update_banner"
  | "delete_banner"
  | "create_announcement"
  | "update_announcement"
  | "delete_announcement"
  | "ban_user"
  | "unban_user"
  | "update_story"
  | "reject_story"
  | "feature_story"
  | "unfeature_story";

type TargetType =
  | "user"
  | "author"
  | "deposit"
  | "withdrawal"
  | "ad_placement"
  | "announcement"
  | "story";

interface LogDetails {
  amount?: number;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function logAdminAction(
  adminId: string,
  action: AdminAction,
  targetType: TargetType,
  targetId: string,
  details?: LogDetails,
  req?: express.Request
) {
  try {
    await prisma.adminActionLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        details: details ?? undefined,
        ipAddress: req?.ip ?? null,
        userAgent: req?.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to log admin action:", error);
  }
}

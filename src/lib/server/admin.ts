import { applyAdminGrant, type AdminIdentity } from "./admin-provision";
import { randomUUID } from "node:crypto";
import { database, transaction } from "./db";
import { assert, AppError } from "../domain";
import type { AccessAccount, AccessStatus } from "../auth-types";
export async function adminAccounts() {
  const { rows } = await database().query(
    "SELECT id,username,phone,role,access_status,created_at,reviewed_at FROM users ORDER BY CASE WHEN access_status='pending' THEN 0 ELSE 1 END,created_at DESC,id",
  );
  return rows as AccessAccount[];
}
export async function reviewAccount(
  adminId: string,
  targetId: unknown,
  action: unknown,
  expectedStatus: unknown,
  expectedRole?: unknown,
) {
  assert(typeof targetId === "string", "请选择账号");
  const transitions: Record<string, { from: AccessStatus; to: AccessStatus }> =
    {
      approve: { from: "pending", to: "approved" },
      reject: { from: "pending", to: "rejected" },
      disable: { from: "approved", to: "disabled" },
      enable: { from: "disabled", to: "approved" },
    };
  assert(
    typeof action === "string" &&
      (action === "promote" || Object.hasOwn(transitions, action)),
    "审核操作无效",
  );
  const transition = transitions[action];
  return transaction(async (db) => {
    const admin = (
      await db.query("SELECT role,access_status FROM users WHERE id=$1", [
        adminId,
      ])
    ).rows[0];
    if (admin?.role !== "admin" || admin.access_status !== "approved")
      throw new AppError("需要管理员权限", 403);
    const target = (
      await db.query(
        "SELECT id,phone,username,role,access_status FROM users WHERE id=$1",
        [targetId],
      )
    ).rows[0];
    if (!target) throw new AppError("账号不存在", 404);
    if (action === "promote") {
      if (
        target.role !== "member" ||
        target.access_status !== "approved" ||
        expectedStatus !== "approved" ||
        expectedRole !== "member"
      )
        throw new AppError(
          "仅可将已通过的普通用户设为管理员，请刷新后重试",
          409,
        );
      await applyAdminGrant(
        db,
        target as AdminIdentity,
        "admin_dashboard",
        adminId,
      );
      return { ok: true };
    }
    assert(target.role !== "admin", "不能在此修改管理员账号");
    if (
      target.access_status !== expectedStatus ||
      target.access_status !== transition.from
    )
      throw new AppError("账号状态已变化，请刷新后重试", 409);
    const at = Date.now();
    await db.query(
      "UPDATE users SET access_status=$1,reviewed_at=$2,reviewed_by=$3 WHERE id=$4",
      [transition.to, at, adminId, targetId],
    );
    if (transition.to !== "approved")
      await db.query("DELETE FROM user_sessions WHERE user_id=$1", [targetId]);
    await db.query(
      "INSERT INTO user_access_reviews(id,user_id,reviewer_id,previous_status,next_status,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), targetId, adminId, transition.from, transition.to, at],
    );
    return { ok: true };
  });
}

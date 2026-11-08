export type AccessStatus = "pending" | "approved" | "rejected" | "disabled";
export type AuthUser = {
  id: string;
  username: string;
  avatarUrl: string;
  role: "member" | "admin";
};
export type AccessAccount = {
  id: string;
  username: string;
  phone: string;
  role: "member" | "admin";
  access_status: AccessStatus;
  created_at: number;
  reviewed_at: number | null;
};
export const ACCESS_LABELS: Record<AccessStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  disabled: "已停用",
};

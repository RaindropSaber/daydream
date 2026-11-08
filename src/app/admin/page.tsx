import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { sessionUser, SESSION_COOKIE } from "@/lib/server/auth";
import { AdminDashboard } from "@/components/admin-dashboard";
export default async function AdminPage() {
  const user = await sessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/?login=1");
  if (user.role !== "admin") notFound();
  return <AdminDashboard user={user} />;
}

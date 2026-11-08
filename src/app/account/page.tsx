import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser, SESSION_COOKIE } from "@/lib/server/auth";
import { accountProfile } from "@/lib/server/account";
import { AccountSettings } from "@/components/account-settings";
export default async function AccountPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await sessionUser(token);
  if (!user) redirect("/?login=1");
  return <AccountSettings user={user} profile={await accountProfile(token)} />;
}

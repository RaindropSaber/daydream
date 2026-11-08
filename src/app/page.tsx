import { redirect } from "next/navigation";
import { hasAdministrator } from "@/lib/server/initial-setup";
import { cookies } from "next/headers";
import { sessionUser, SESSION_COOKIE } from "@/lib/server/auth";
import { HomePage } from "@/components/home-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const store = await cookies();
  if (!(await hasAdministrator())) redirect("/admin/setup");
  const user = await sessionUser(store.get(SESSION_COOKIE)?.value);
  return (
    <HomePage
      user={user}
      initialLogin={(await searchParams).login === "1" && !user}
    />
  );
}

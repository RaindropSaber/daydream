import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser, SESSION_COOKIE } from "@/lib/server/auth";
import { StudioProviders } from "@/components/studio/app";

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await sessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/?login=1");
  return <StudioProviders user={user}>{children}</StudioProviders>;
}

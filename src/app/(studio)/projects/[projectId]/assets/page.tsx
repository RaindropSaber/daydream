import StudioApp from "@/components/studio/app";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    asset?: string | string[];
    state?: string | string[];
  }>;
}) {
  const { projectId } = await params;
  const selection = await searchParams;
  return (
    <StudioApp
      route={{
        view: "assets",
        project: projectId,
        asset:
          typeof selection.asset === "string" ? selection.asset : undefined,
        state:
          typeof selection.state === "string" ? selection.state : undefined,
      }}
    />
  );
}

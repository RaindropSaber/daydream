import StudioApp from "@/components/studio/app";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; episodeId: string }>;
  searchParams: Promise<{
    run?: string | string[];
    version?: string | string[];
  }>;
}) {
  const { projectId, episodeId } = await params;
  const selection = await searchParams;
  return (
    <StudioApp
      route={{
        view: "episode",
        project: projectId,
        episode: episodeId,
        run: typeof selection.run === "string" ? selection.run : undefined,
        version:
          typeof selection.version === "string" ? selection.version : undefined,
      }}
    />
  );
}

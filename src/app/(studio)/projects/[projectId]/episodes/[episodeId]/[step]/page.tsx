import StudioApp from "@/components/studio/app";
import { notFound } from "next/navigation";
import { isStudioStep } from "@/lib/studio-routes";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; episodeId: string; step: string }>;
  searchParams: Promise<{
    run?: string | string[];
    version?: string | string[];
  }>;
}) {
  const { projectId, episodeId, step } = await params;
  const selection = await searchParams;
  if (!isStudioStep(step)) notFound();
  return (
    <StudioApp
      route={{
        view: "episode",
        project: projectId,
        episode: episodeId,
        step,
        run: typeof selection.run === "string" ? selection.run : undefined,
        version:
          typeof selection.version === "string" ? selection.version : undefined,
      }}
    />
  );
}

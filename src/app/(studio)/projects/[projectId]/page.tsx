import StudioApp from "@/components/studio/app";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StudioApp route={{ view: "overview", project: projectId }} />;
}

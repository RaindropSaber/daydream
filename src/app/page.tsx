import { Suspense } from "react";
import StudioApp from "@/components/studio/app";
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-sm text-muted-foreground">正在载入…</div>
      }
    >
      <StudioApp />
    </Suspense>
  );
}

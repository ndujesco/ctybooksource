import { Suspense } from "react";
import ReportsView from "@/components/ReportsView";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading label="Adding it up" />}>
      <ReportsView />
    </Suspense>
  );
}

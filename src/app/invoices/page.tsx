import { Suspense } from "react";
import InvoicesView from "@/components/InvoicesView";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading label="Loading invoices" />}>
      <InvoicesView />
    </Suspense>
  );
}

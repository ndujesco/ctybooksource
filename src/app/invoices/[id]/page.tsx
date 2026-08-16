import InvoiceEditor from "@/components/InvoiceEditor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceEditor id={id} />;
}

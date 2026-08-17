import { redirect } from "next/navigation";

// The dashboard was removed; invoices is the home screen.
export default function Page() {
  redirect("/invoices");
}

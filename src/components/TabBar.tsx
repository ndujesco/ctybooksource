"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Building2, LineChart, Receipt } from "lucide-react";

const TABS = [
  { href: "/invoices", label: "Invoices", icon: Receipt, match: (p: string) => p === "/" || p.startsWith("/invoice") },
  { href: "/customers", label: "Schools", icon: Building2, match: (p: string) => p.startsWith("/customers") },
  { href: "/books", label: "Books", icon: BookOpen, match: (p: string) => p.startsWith("/books") },
  { href: "/reports", label: "Reports", icon: LineChart, match: (p: string) => p.startsWith("/reports") },
];

export default function TabBar() {
  const pathname = usePathname() || "/";

  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--rule)] bg-[var(--card)]/95 backdrop-blur"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-[680px] items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const on = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className="flex flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-semibold"
                style={{ color: on ? "var(--ink)" : "var(--ink-3)" }}
              >
                <Icon size={20} strokeWidth={on ? 2.2 : 1.7} aria-hidden />
                {label}
                {/* The active tab is underscored in gold — the ledger's ruled tab marker. */}
                <span
                  className="h-[2px] w-6 rounded-full"
                  style={{ background: on ? "var(--gold)" : "transparent" }}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

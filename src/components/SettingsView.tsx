"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  FONT_STEPS,
  setBusiness,
  setFontScale,
  setToggles,
  type Business,
  type HeaderToggles,
} from "@/lib/settings";
import { useBusiness, useFontScale, useHeaderToggles } from "@/lib/use-settings";
import { Labelled, PageHeader, Section } from "@/components/ui";

export default function SettingsView() {
  // Every control here writes straight through to the store, and the store is
  // what renders them — so there's no second copy of the truth to keep in sync,
  // and other open screens pick the change up immediately.
  const business = useBusiness();
  const toggles = useHeaderToggles();
  const scale = useFontScale();

  const patchBusiness = (patch: Partial<Business>) => setBusiness({ ...business, ...patch });
  const patchToggle = (key: keyof HeaderToggles) =>
    setToggles({ ...toggles, [key]: !toggles[key] });

  return (
    <main>
      <PageHeader title="Settings" subtitle="Saved on this device only." back="/" />

      <Section title="Your business" note="Prints at the top of every invoice">
        <div className="card space-y-3 px-3.5 py-3.5">
          <Labelled label="Business name">
            <input
              className="field mt-1"
              value={business.name}
              onChange={(e) => patchBusiness({ name: e.target.value })}
              placeholder="CTY Booksource"
            />
          </Labelled>
          <Labelled label="Phone" hint="Separate several numbers with commas.">
            <input
              className="field mt-1"
              value={business.phone}
              onChange={(e) => patchBusiness({ phone: e.target.value })}
              placeholder="0801 234 5678, 0802 345 6789"
            />
          </Labelled>
          <Labelled label="Email">
            <input
              className="field mt-1"
              type="email"
              value={business.email}
              onChange={(e) => patchBusiness({ email: e.target.value })}
            />
          </Labelled>
          <Labelled label="Address">
            <input
              className="field mt-1"
              value={business.address}
              onChange={(e) => patchBusiness({ address: e.target.value })}
            />
          </Labelled>
        </div>
      </Section>

      <Section title="What shows on the invoice">
        <ul className="card ruled overflow-hidden px-3.5">
          {(
            [
              ["name", "Business name"],
              ["phone", "Phone"],
              ["email", "Email"],
              ["address", "Address"],
            ] as const
          ).map(([key, label]) => (
            <li key={key} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{label}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--ink)]"
                checked={toggles[key]}
                onChange={() => patchToggle(key)}
                aria-label={`Show ${label} on invoices`}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Text size">
        <div className="card px-3.5 py-3.5">
          <div className="segment w-full">
            {FONT_STEPS.map((s) => (
              <button
                key={s}
                type="button"
                className="flex-1"
                data-on={s === scale}
                aria-pressed={s === scale}
                onClick={() => {
                  setFontScale(s);
                }}
                style={{ fontSize: `${0.75 + (s - 0.9) * 0.6}rem` }}
              >
                A
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-[var(--ink-2)]">
            Makes everything in the app bigger. The printed invoice is unaffected.
          </p>
        </div>
      </Section>

      <Section title="Records">
        <Link href="/invoices/trash" className="card flex items-center gap-3 px-3.5 py-3">
          <Trash2 size={18} className="text-[var(--ink-2)]" />
          <span className="flex-1 text-sm font-medium">Deleted invoices</span>
          <span className="text-xs text-[var(--ink-3)]">Restore or clear</span>
        </Link>
      </Section>
    </main>
  );
}

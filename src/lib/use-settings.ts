"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_BUSINESS,
  DEFAULT_TOGGLES,
  getBusiness,
  getDefaultNameMode,
  getFontScale,
  getToggles,
  subscribeToSettings,
  type Business,
  type HeaderToggles,
} from "@/lib/settings";

/* ---------------------------------------------------------------------------
   Settings live in localStorage, which the server can't see. Reading them
   during render would desync the server and client HTML; reading them in an
   effect costs a second render pass on every screen that shows them.

   `useSyncExternalStore` is the fit: it renders the defaults on the server,
   swaps to the stored values on hydration, and re-renders anything showing a
   setting the moment Settings changes it.
   ------------------------------------------------------------------------ */

export function useBusiness(): Business {
  return useSyncExternalStore(subscribeToSettings, getBusiness, () => DEFAULT_BUSINESS);
}

export function useHeaderToggles(): HeaderToggles {
  return useSyncExternalStore(subscribeToSettings, getToggles, () => DEFAULT_TOGGLES);
}

export function useDefaultNameMode(): "short" | "full" {
  return useSyncExternalStore(subscribeToSettings, getDefaultNameMode, () => "short" as const);
}

export function useFontScale(): number {
  return useSyncExternalStore(subscribeToSettings, getFontScale, () => 1);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   Autosave that doesn't lose work.

   Four things go wrong with a naive debounce, and all four have happened to
   someone writing an invoice on a phone in a school car park:

   1. An edit made *while* a save is in flight gets overwritten by that save's
      response, or is simply never sent. Here, edits that arrive mid-flight are
      held and sent the moment the flight lands — the newest state always wins.
   2. Two saves overlap and the server applies them out of order. Here only one
      request is ever in the air, so the order is the order they were typed.
   3. The connection drops and the edit is silently gone. Here a failed save
      retries on a backoff, retries at once when the network comes back, and
      says plainly that it hasn't saved yet — the local mirror holds the work
      in the meantime.
   4. The tab is closed mid-debounce. Here leaving the page flushes immediately
      with `keepalive`, so the request outlives the page.
   ------------------------------------------------------------------------ */

export type SaveStatus =
  | "idle" // nothing outstanding
  | "dirty" // typed, waiting for the debounce
  | "saving"
  | "saved"
  | "retrying"; // a save failed; the work is safe locally and will go again

const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

export type Autosave<T> = {
  status: SaveStatus;
  /** Set when a save has failed and not yet succeeded. */
  error: string;
  /** True while anything typed hasn't reached the server. */
  unsaved: boolean;
  /** Record a change: mirrored locally now, sent after the debounce. */
  queue: (data: T) => void;
  /** Send whatever is outstanding right now, and wait for it. */
  flush: () => Promise<void>;
  /** Try again immediately after a failure. */
  retry: () => void;
};

export function useAutosave<T>(opts: {
  save: (data: T, o: { keepalive: boolean }) => Promise<unknown>;
  /** Keystroke-level local copy, so a reload before the save lands loses nothing. */
  mirror?: (data: T) => void;
  clearMirror?: () => void;
  delay?: number;
}): Autosave<T> {
  const { delay = 700 } = opts;

  // Everything the loop needs lives in refs: the callbacks change identity on
  // every render of the editor, and the save loop must not be torn down by
  // that. They're refreshed after each render, which is always before anything
  // can call them — the loop only ever runs from a timer or an event.
  const save = useRef(opts.save);
  const mirror = useRef(opts.mirror);
  const clearMirror = useRef(opts.clearMirror);
  useEffect(() => {
    save.current = opts.save;
    mirror.current = opts.mirror;
    clearMirror.current = opts.clearMirror;
  });

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");

  const pending = useRef<T | null>(null); // newest state not yet confirmed saved
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A loop rather than a recursive call: while something is outstanding it keeps
  // sending, so an edit made during a flight goes up the moment that flight
  // lands, and only ever one request is in the air.
  const run = useCallback(async (keepalive = false): Promise<void> => {
    if (inFlight.current) return; // the flight in progress will pick up what's newest
    if (pending.current === null) return;

    inFlight.current = true;
    try {
      while (pending.current !== null) {
        const data: T = pending.current;
        if (backoff.current) clearTimeout(backoff.current);
        if (alive.current) setStatus("saving");

        try {
          await save.current(data, { keepalive });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Couldn't save";
          if (alive.current) {
            setError(message);
            setStatus("retrying");
          }
          const wait = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
          attempt.current++;
          backoff.current = setTimeout(() => void runRef.current(), wait);
          return; // the work stays in `pending`, and in the local mirror
        }

        attempt.current = 0;
        if (alive.current) setError("");

        if (pending.current === data) {
          // Nothing was typed while this was in the air — level with the server.
          pending.current = null;
          clearMirror.current?.();
          if (alive.current) setStatus("saved");
        }
        // Otherwise something newer arrived mid-flight: go round again.
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  // The backoff timer fires long after the closure that scheduled it, so it
  // reaches the loop through a ref rather than capturing it.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const queue = useCallback(
    (data: T) => {
      pending.current = data;
      mirror.current?.(data);
      // A failure already showing stays showing — the work isn't safe yet, and
      // flipping back to "unsaved changes" would read as if it had recovered.
      setStatus((s) => (s === "retrying" ? s : "dirty"));
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void run(), delay);
    },
    [delay, run]
  );

  const flush = useCallback(async () => {
    if (debounce.current) clearTimeout(debounce.current);
    await run();
  }, [run]);

  const retry = useCallback(() => {
    attempt.current = 0;
    void run();
  }, [run]);

  /* Leaving the page, and coming back online. ----------------------------- */

  useEffect(() => {
    const leave = () => {
      if (pending.current === null) return;
      if (debounce.current) clearTimeout(debounce.current);
      // keepalive lets the request outlive the page it was sent from.
      void run(true);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") leave();
    };
    const onOnline = () => {
      if (pending.current !== null) retry();
    };

    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
      if (debounce.current) clearTimeout(debounce.current);
      if (backoff.current) clearTimeout(backoff.current);
      // Unmounting with work outstanding (tapping Back, say) still sends it.
      if (pending.current !== null) void run(true);
    };
  }, [run, retry]);

  return {
    status,
    error,
    unsaved: status === "dirty" || status === "saving" || status === "retrying",
    queue,
    flush,
    retry,
  };
}

/** Human wording for the save indicator. */
export function saveLabel(status: SaveStatus): string {
  switch (status) {
    case "dirty":
      return "Unsaved…";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "retrying":
      return "Not saved — retrying";
    default:
      return "Up to date";
  }
}

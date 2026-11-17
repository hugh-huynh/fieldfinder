"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { reverseQuery, withoutCountry, type ReverseResponse } from "@/features/locations/query";
import { cx } from "@/lib/cx";

import { setDeviceFix } from "../device-fix";
import { FALLBACK_LABEL, geoMessage, geoReducer, POSITION_OPTIONS } from "../geolocation";
import { deviceLocation, parseSearchState, serializeSearchState } from "../state";

// "Use my location" (spec §3 "Search behavior", ADR-0005, PR 3.9).
// - Never prompts on its own. With `autoFill` (the landing page), the position is read automatically
//   only when the Permissions API says access is already granted, once per page load, and only if
//   the person hasn't chosen or started typing a place.
// - Otherwise the person presses the button, which may show the browser's own prompt.
// - The precise position stays in memory (device-fix.ts). The URL gets it rounded to 2 dp, and the
//   locality name comes from GET /api/locations/reverse with the rounded position.
// - A manual press pushes a history entry (a search); an automatic fill replaces the empty landing
//   page, so Back doesn't return to it.

/** Once per page load: coming back to the landing page later doesn't locate the person again. */
let autoFillTried = false;

/** Has the person picked a place, or started typing one? Then an automatic fill must not replace it. */
function placeChosen(): boolean {
  if (parseSearchState(new URLSearchParams(window.location.search)).location !== null) return true;
  const input = document.querySelector<HTMLInputElement>('[role="search"] input[role="combobox"]');
  return input !== null && (input === document.activeElement || input.value.trim() !== "");
}

async function localityLabel(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`/api/locations/reverse?${reverseQuery(lat, lng)}`);
    if (!res.ok) return FALLBACK_LABEL;
    const body = (await res.json()) as ReverseResponse;
    return body.place === null ? FALLBACK_LABEL : withoutCountry(body.place.label);
  } catch {
    return FALLBACK_LABEL;
  }
}

export function UseMyLocation({ autoFill = false, compact = false }: { autoFill?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [status, dispatch] = useReducer(geoReducer, "checking");
  const mounted = useRef(true);

  function locate(auto: boolean) {
    dispatch({ type: "locate" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          const { latitude, longitude } = position.coords;
          setDeviceFix({ lat: latitude, lng: longitude });
          const label = await localityLabel(latitude, longitude);
          if (!mounted.current) return;
          dispatch({ type: "located" });
          if (auto && placeChosen()) return;
          const location = deviceLocation(latitude, longitude, label);
          if (location === null) return;
          const { filters } = parseSearchState(new URLSearchParams(window.location.search));
          const url = `/?${serializeSearchState({ location, filters })}`;
          if (auto) router.replace(url);
          else router.push(url);
        })();
      },
      (error) => {
        if (mounted.current) dispatch({ type: "failed", code: error.code });
      },
      POSITION_OPTIONS,
    );
  }

  const latestLocate = useRef(locate);
  useEffect(() => {
    latestLocate.current = locate;
  });

  useEffect(() => {
    mounted.current = true;
    let status: PermissionStatus | null = null;
    const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
    // Older browsers have no Permissions API, whatever the DOM types say.
    const permissionsApi = supported && "permissions" in navigator && typeof navigator.permissions.query === "function";
    // Asynchronous, so the first render (server and client) is the same.
    queueMicrotask(() => {
      dispatch({ type: "init", supported, permissionsApi });
    });
    if (permissionsApi) {
      navigator.permissions.query({ name: "geolocation" }).then(
        (result) => {
          if (!mounted.current) return;
          status = result;
          dispatch({ type: "permission", state: result.state });
          result.onchange = () => {
            dispatch({ type: "permission", state: result.state });
          };
          if (result.state === "granted" && autoFill && !autoFillTried && !placeChosen()) {
            autoFillTried = true;
            latestLocate.current(true);
          }
        },
        // Some browsers refuse to say: treat as undecided, never prompt.
        () => {
          if (mounted.current) dispatch({ type: "permission", state: "prompt" });
        },
      );
    }
    return () => {
      mounted.current = false;
      if (status !== null) status.onchange = null;
    };
  }, [autoFill]);

  if (status === "unsupported") return null;
  const message = geoMessage(status);

  return (
    <div className={cx("flex flex-col items-start gap-2", compact ? "mt-2" : "mt-6")}>
      <Button
        variant={compact ? "ghost" : "secondary"}
        className={compact ? "-ml-2 px-2" : undefined}
        aria-busy={status === "locating"}
        onClick={() => {
          locate(false);
        }}
      >
        <LocateIcon />
        Use my location
      </Button>
      <p role="status" className={cx("text-sm text-muted", message === "" && "sr-only")}>
        {message}
      </p>
    </div>
  );
}

function LocateIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/** For tests: forget that an automatic fill was tried on this "page load". */
export function resetAutoFillForTests(): void {
  autoFillTried = false;
}

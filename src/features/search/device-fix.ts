import { useSyncExternalStore } from "react";

import { DEVICE_COORDINATE_DECIMALS, type SearchLocation } from "./state";

// The device's precise position, kept in this tab's memory only (ADR-0005, PR 3.9). It never goes
// into the URL, an API request, history.state, storage, logs or analytics: those get the position
// rounded to 2 dp. It's used for one thing: showing true distances to venues when the search is
// "near me". A reload forgets it, and distances then come from the (rounded) search centre.

export interface DeviceFix {
  lat: number;
  lng: number;
}

let fix: DeviceFix | null = null;
const listeners = new Set<() => void>();

export function setDeviceFix(next: DeviceFix | null): void {
  fix = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDeviceFix(): DeviceFix | null {
  return useSyncExternalStore(
    subscribe,
    () => fix,
    () => null,
  );
}

const round = (value: number) =>
  Math.round(value * 10 ** DEVICE_COORDINATE_DECIMALS) / 10 ** DEVICE_COORDINATE_DECIMALS;

/** True when `location` is the device fix's rounded position, i.e. the search is "near me". */
export function isNearFix(location: SearchLocation | null, device: DeviceFix | null): device is DeviceFix {
  return (
    location !== null && device !== null && location.lat === round(device.lat) && location.lng === round(device.lng)
  );
}

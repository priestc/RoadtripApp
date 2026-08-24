"use client";

import {
  LUNCH_WINDOW_END,
  LUNCH_WINDOW_START,
  secondsAtDrivingFraction,
  timeStringToSeconds,
  type DayItineraryStop,
  type LunchSelection,
  type RouteDaySegment,
} from "@/lib/routeDays";

/** Picks a point along a day's driving path at a given 0..1 fraction. */
export function pointAtFraction(
  day: RouteDaySegment,
  fraction: number
): google.maps.LatLngLiteral {
  const index = Math.min(
    Math.max(Math.round(fraction * (day.path.length - 1)), 0),
    day.path.length - 1
  );
  return day.path[index];
}

/** Nearest point on a day's driving path to an arbitrary lat/lng, as a 0..1
 * fraction — a simple squared-distance nearest-neighbor scan. */
export function nearestFractionOnPath(
  day: RouteDaySegment,
  point: { lat: number; lng: number }
): number {
  let bestIndex = 0;
  let bestDistSq = Infinity;
  day.path.forEach((p, index) => {
    const dLat = p.lat - point.lat;
    const dLng = p.lng - point.lng;
    const distSq = dLat * dLat + dLng * dLng;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = index;
    }
  });
  return day.path.length > 1 ? bestIndex / (day.path.length - 1) : 0;
}

/** Departure and arrival are both a hotel from the map's point of view. */
export function mapMarkerLabel(label: DayItineraryStop["label"]): string {
  return label === "Departure" || label === "Arrival" ? "Hotel" : label;
}

/** Where to actually place a stop's marker: the selected restaurant's real
 * coordinates for a chosen Lunch stop (its drivingFraction is only an
 * approximation used for ETA/geocoding, not its true location), otherwise
 * the corresponding point along the day's route. */
export function markerPosition(
  day: RouteDaySegment,
  stop: DayItineraryStop,
  selectedLunch: LunchSelection | null
): google.maps.LatLngLiteral {
  if (
    stop.label === "Lunch" &&
    selectedLunch &&
    Number.isFinite(selectedLunch.lat) &&
    Number.isFinite(selectedLunch.lng)
  ) {
    return { lat: selectedLunch.lat, lng: selectedLunch.lng };
  }
  return pointAtFraction(day, stop.drivingFraction);
}

/** Pulls a "City, State" label out of a geocoding result, falling back to
 * progressively broader area types for the city part if there's no exact
 * locality (e.g. a point out in the countryside). */
export function extractCityName(
  result: google.maps.GeocoderResult | undefined
): string | null {
  if (!result) return null;
  const candidateTypes = [
    "locality",
    "administrative_area_level_3",
    "administrative_area_level_2",
  ];
  let city: string | null = null;
  for (const type of candidateTypes) {
    const component = result.address_components.find((c) =>
      c.types.includes(type)
    );
    if (component) {
      city = component.long_name;
      break;
    }
  }
  if (!city) return null;

  const stateComponent = result.address_components.find((c) =>
    c.types.includes("administrative_area_level_1")
  );
  return stateComponent ? `${city}, ${stateComponent.short_name}` : city;
}

interface LunchSearchResult {
  placeId: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  city: string | null;
}

const LUNCH_WINDOW_START_SECONDS = timeStringToSeconds(LUNCH_WINDOW_START);
const LUNCH_WINDOW_END_SECONDS = timeStringToSeconds(LUNCH_WINDOW_END);

/** Searches for restaurants along a single day's route, projects each onto
 * the route for an ETA, filters to the lunch window, and sorts
 * chronologically. */
export async function searchLunchForDay(
  geometryLibrary: google.maps.GeometryLibrary,
  day: RouteDaySegment,
  dayHasDinner: boolean
): Promise<LunchSelection[]> {
  const encodedPolyline = geometryLibrary.encoding.encodePath(day.path);
  let results: LunchSearchResult[];
  try {
    const res = await fetch("/api/places/lunch-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encodedPolyline }),
    });
    results = res.ok ? await res.json() : [];
  } catch {
    results = [];
  }

  return results
    .map((r): LunchSelection => {
      const drivingFraction = nearestFractionOnPath(day, {
        lat: r.lat,
        lng: r.lng,
      });
      return {
        placeId: r.placeId,
        name: r.name,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        city: r.city,
        drivingFraction,
        secondsSinceMidnight: secondsAtDrivingFraction(
          day.durationSeconds,
          dayHasDinner,
          drivingFraction
        ),
      };
    })
    .filter(
      (option) =>
        option.secondsSinceMidnight >= LUNCH_WINDOW_START_SECONDS &&
        option.secondsSinceMidnight <= LUNCH_WINDOW_END_SECONDS
    )
    .sort((a, b) => a.secondsSinceMidnight - b.secondsSinceMidnight);
}

interface GasSearchResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  pricePerGallon: number;
  city: string | null;
}

export interface CheapestGasStop {
  /** The cheapest city's name (not a single station's). */
  city: string;
  /** That city's average price across its stations found along the route. */
  avgPricePerGallon: number;
  /** Centroid of that city's stations, used as the map position. */
  lat: number;
  lng: number;
  drivingFraction: number;
  secondsSinceMidnight: number;
}

/** Searches for gas stations (with current pricing) along a single day's
 * full route, groups them by city, and returns that day's overall average
 * price plus whichever city has the cheapest average. */
export async function searchGasForDay(
  geometryLibrary: google.maps.GeometryLibrary,
  day: RouteDaySegment,
  dayHasDinner: boolean
): Promise<{ cheapest: CheapestGasStop | null; average: number | null }> {
  const encodedPolyline = geometryLibrary.encoding.encodePath(day.path);
  let results: GasSearchResult[];
  try {
    const res = await fetch("/api/places/gas-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encodedPolyline }),
    });
    results = res.ok ? await res.json() : [];
  } catch {
    results = [];
  }

  if (results.length === 0) {
    return { cheapest: null, average: null };
  }

  const average =
    results.reduce((sum, r) => sum + r.pricePerGallon, 0) / results.length;

  // Group by city (skipping stations whose city couldn't be determined --
  // they can't be grouped) and average each city's prices, then find the
  // cheapest city overall.
  const byCity: Record<string, GasSearchResult[]> = {};
  for (const r of results) {
    if (!r.city) continue;
    (byCity[r.city] ??= []).push(r);
  }

  let cheapest: CheapestGasStop | null = null;
  for (const [city, stations] of Object.entries(byCity)) {
    const cityAverage =
      stations.reduce((sum, s) => sum + s.pricePerGallon, 0) / stations.length;
    if (!cheapest || cityAverage < cheapest.avgPricePerGallon) {
      const lat = stations.reduce((sum, s) => sum + s.lat, 0) / stations.length;
      const lng = stations.reduce((sum, s) => sum + s.lng, 0) / stations.length;
      const drivingFraction = nearestFractionOnPath(day, { lat, lng });
      cheapest = {
        city,
        avgPricePerGallon: cityAverage,
        lat,
        lng,
        drivingFraction,
        secondsSinceMidnight: secondsAtDrivingFraction(
          day.durationSeconds,
          dayHasDinner,
          drivingFraction
        ),
      };
    }
  }

  return { cheapest, average };
}


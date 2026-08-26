"use client";

import {
  FUEL_RESERVE_MILES,
  LUNCH_WINDOW_END,
  LUNCH_WINDOW_START,
  metersToMiles,
  secondsAtDrivingFraction,
  timeStringToSeconds,
  type DayItineraryStop,
  type FuelStopSelection,
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

// Google's "search along route" places search returns a small, sparse set
// of stations for a single long polyline no matter how many are actually
// out there -- running it separately per ~100mi chunk of the route (instead
// of one call for the whole day) gets each chunk its own allocation of
// results, surfacing far more cities. Segments overlap by one point at each
// boundary so no stretch of road is left unsearched.
const MILES_PER_GAS_SEARCH_SEGMENT = 100;
const MAX_GAS_SEARCH_SEGMENTS = 6;

function splitPathIntoSegments(
  path: google.maps.LatLngLiteral[],
  numSegments: number
): google.maps.LatLngLiteral[][] {
  if (numSegments <= 1 || path.length < 2) return [path];
  const segments: google.maps.LatLngLiteral[][] = [];
  const pointsPerSegment = (path.length - 1) / numSegments;
  for (let i = 0; i < numSegments; i++) {
    const startIndex = Math.floor(i * pointsPerSegment);
    const endIndex = Math.floor((i + 1) * pointsPerSegment);
    segments.push(path.slice(startIndex, endIndex + 1));
  }
  return segments;
}

async function fetchGasSegment(encodedPolyline: string): Promise<GasSearchResult[]> {
  try {
    const res = await fetch("/api/places/gas-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encodedPolyline }),
    });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
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
 * price (always computed across every station found, regardless of
 * `maxDrivingFraction`) plus every city's average price (`byCity`) and
 * whichever has the cheapest average (`cheapest`), both restricted to
 * stations reachable within `maxDrivingFraction` (0..1) of the day's route —
 * 1 (the default) considers the whole day. */
export async function searchGasForDay(
  geometryLibrary: google.maps.GeometryLibrary,
  day: RouteDaySegment,
  dayHasDinner: boolean,
  maxDrivingFraction: number = 1
): Promise<{
  cheapest: CheapestGasStop | null;
  average: number | null;
  byCity: CheapestGasStop[];
}> {
  const numSegments = Math.min(
    MAX_GAS_SEARCH_SEGMENTS,
    Math.max(1, Math.round(metersToMiles(day.distanceMeters) / MILES_PER_GAS_SEARCH_SEGMENT))
  );
  const encodedPolylines = splitPathIntoSegments(day.path, numSegments).map((segment) =>
    geometryLibrary.encoding.encodePath(segment)
  );
  const segmentResults = await Promise.all(encodedPolylines.map(fetchGasSegment));

  const seenPlaceIds = new Set<string>();
  const results: GasSearchResult[] = segmentResults.flat().filter((r) => {
    if (seenPlaceIds.has(r.placeId)) return false;
    seenPlaceIds.add(r.placeId);
    return true;
  });

  if (results.length === 0) {
    return { cheapest: null, average: null, byCity: [] };
  }

  const average =
    results.reduce((sum, r) => sum + r.pricePerGallon, 0) / results.length;

  const reachableResults =
    maxDrivingFraction >= 1
      ? results
      : results.filter(
          (r) => nearestFractionOnPath(day, { lat: r.lat, lng: r.lng }) <= maxDrivingFraction
        );

  // Group by city (skipping stations whose city couldn't be determined --
  // they can't be grouped) and average each city's prices.
  const byCityStations: Record<string, GasSearchResult[]> = {};
  for (const r of reachableResults) {
    if (!r.city) continue;
    (byCityStations[r.city] ??= []).push(r);
  }

  const byCity: CheapestGasStop[] = Object.entries(byCityStations).map(
    ([city, stations]) => {
      const avgPricePerGallon =
        stations.reduce((sum, s) => sum + s.pricePerGallon, 0) / stations.length;
      const lat = stations.reduce((sum, s) => sum + s.lat, 0) / stations.length;
      const lng = stations.reduce((sum, s) => sum + s.lng, 0) / stations.length;
      const drivingFraction = nearestFractionOnPath(day, { lat, lng });
      return {
        city,
        avgPricePerGallon,
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
  );

  const cheapest = byCity.reduce<CheapestGasStop | null>(
    (best, stop) => (!best || stop.avgPricePerGallon < best.avgPricePerGallon ? stop : best),
    null
  );

  return { cheapest, average, byCity };
}

export interface AutoFuelPlanVehicle {
  gasMileageMpg: number;
  fuelCapacityGallons: number;
}

export interface AutoFuelPlanResult {
  /** One array of fuel stops per day, ready to replace that day's existing
   * stops entirely. */
  stopsByDay: FuelStopSelection[][];
  /** True if at least one stop had to be placed beyond the safe
   * (range - FUEL_RESERVE_MILES) window because no gas city was reachable
   * within it -- i.e. the route's stations are sparser than the vehicle's
   * range can comfortably cover. */
  exceededReserve: boolean;
}

/**
 * Plans fuel stops for an entire multi-day trip in one pass. Starting from
 * `initialFuelRangeMiles` (whatever's already in the tank at departure), it
 * repeatedly drives to the cheapest gas city reachable within the current
 * tank's safe range (current range minus FUEL_RESERVE_MILES) -- skipping
 * over pricier cities along the way -- assumes a full fill-up there, and
 * repeats until the remaining trip distance fits in what's left in the
 * tank. Landing "roughly at half tank" on average is an emergent property
 * of this (gas cities tend to be reasonably evenly priced/spaced), not a
 * separate target: the only hard rule is picking the cheapest city inside
 * the current safe window, which sometimes means driving nearly the full
 * safe range to reach one.
 */
export async function planAutomaticFuelStops(
  geometryLibrary: google.maps.GeometryLibrary,
  days: RouteDaySegment[],
  dayHasDinner: boolean[],
  vehicle: AutoFuelPlanVehicle,
  initialFuelRangeMiles: number
): Promise<AutoFuelPlanResult> {
  interface Candidate {
    city: string;
    avgPricePerGallon: number;
    lat: number;
    lng: number;
    secondsSinceMidnight: number;
    dayIndex: number;
    drivingFractionInDay: number;
    absPositionMiles: number;
  }

  const dayStartMiles: number[] = [];
  let cumulativeMiles = 0;
  for (const day of days) {
    dayStartMiles.push(cumulativeMiles);
    cumulativeMiles += metersToMiles(day.distanceMeters);
  }
  const totalTripMiles = cumulativeMiles;

  const byDayResults = await Promise.all(
    days.map((day, i) => searchGasForDay(geometryLibrary, day, dayHasDinner[i]))
  );

  const candidates: Candidate[] = [];
  byDayResults.forEach((result, dayIndex) => {
    result.byCity.forEach((stop) => {
      candidates.push({
        city: stop.city,
        avgPricePerGallon: stop.avgPricePerGallon,
        lat: stop.lat,
        lng: stop.lng,
        secondsSinceMidnight: stop.secondsSinceMidnight,
        dayIndex,
        drivingFractionInDay: stop.drivingFraction,
        absPositionMiles:
          dayStartMiles[dayIndex] + stop.drivingFraction * metersToMiles(days[dayIndex].distanceMeters),
      });
    });
  });
  candidates.sort((a, b) => a.absPositionMiles - b.absPositionMiles);

  const fullTankRangeMiles = vehicle.fuelCapacityGallons * vehicle.gasMileageMpg;

  const chosen: Candidate[] = [];
  let currentPosition = 0;
  let currentRange = initialFuelRangeMiles;
  let exceededReserve = false;

  const cheapestOf = (pool: Candidate[]): Candidate =>
    pool.reduce((cheapest, c) => (c.avgPricePerGallon < cheapest.avgPricePerGallon ? c : cheapest));

  // At most one stop per candidate -- caps the loop even in a pathological
  // input (e.g. no candidates found at all).
  for (let iteration = 0; iteration < candidates.length + 1; iteration++) {
    const remainingTripMiles = totalTripMiles - currentPosition;
    if (remainingTripMiles <= currentRange - FUEL_RESERVE_MILES) break;

    const safeReachMiles = currentPosition + Math.max(0, currentRange - FUEL_RESERVE_MILES);
    // Real gas prices trend regionally rather than randomly, so simply
    // taking the single cheapest station anywhere in the whole safe range
    // tends to grab whatever's nearby the moment it's cheaper than
    // everything further out -- producing a string of short hops instead of
    // stops "roughly at half tank". Searching the back half of the tank
    // first (extending to the reserve limit only if nothing qualifies
    // there) is what actually produces that spacing while still preferring
    // cheap stations and being willing to skip ahead past pricier ones.
    const halfTankMark = currentPosition + currentRange / 2;
    const backHalfWindowStart = Math.min(halfTankMark, safeReachMiles);
    const backHalfReachable = candidates.filter(
      (c) => c.absPositionMiles >= backHalfWindowStart && c.absPositionMiles <= safeReachMiles
    );
    const fullReachable = candidates.filter(
      (c) => c.absPositionMiles > currentPosition && c.absPositionMiles <= safeReachMiles
    );

    let picked: Candidate | undefined;
    if (backHalfReachable.length > 0) {
      picked = cheapestOf(backHalfReachable);
    } else if (fullReachable.length > 0) {
      // Nothing past the half-tank mark -- take the cheapest of whatever's
      // reachable before it rather than stranding the plan.
      picked = cheapestOf(fullReachable);
    } else {
      // Nothing cheap-and-safe in range at all -- stretching past the
      // reserve to the nearest station beats stranding the plan entirely.
      picked = candidates
        .filter((c) => c.absPositionMiles > currentPosition)
        .sort((a, b) => a.absPositionMiles - b.absPositionMiles)[0];
      if (!picked) break; // no gas stations ahead at all
      exceededReserve = true;
    }

    chosen.push(picked);
    currentPosition = picked.absPositionMiles;
    currentRange = fullTankRangeMiles;
  }

  const stopsByDay: FuelStopSelection[][] = days.map(() => []);
  chosen.forEach((c) => {
    stopsByDay[c.dayIndex].push({
      city: c.city,
      avgPricePerGallon: c.avgPricePerGallon,
      lat: c.lat,
      lng: c.lng,
      drivingFraction: c.drivingFractionInDay,
      secondsSinceMidnight: c.secondsSinceMidnight,
    });
  });
  stopsByDay.forEach((stops) => stops.sort((a, b) => a.drivingFraction - b.drivingFraction));

  return { stopsByDay, exceededReserve };
}

export interface TripFuelPlanStop {
  dayIndex: number;
  city: string;
  arrivalRangeMiles: number;
  gallonsPurchased: number;
  cost: number;
  departureRangeMiles: number;
}

export interface TripFuelPlan {
  stops: TripFuelPlanStop[];
  /** Range left in the tank at the start of each day (index-aligned with
   * `days`), simulated by walking every earlier fuel stop's actual
   * fillStrategy -- day 0 is just `initialFuelRangeMiles` as-is. */
  startOfDayRangeMiles: number[];
  /** Estimated cost of the fuel burned driving each day, attributing every
   * stretch of road to whichever fill-up's gas was in the tank at the time
   * (the most recently purchased stop's price). null for a day where none
   * of its driving happened on priced gas yet (i.e. entirely before the
   * trip's first-ever fill-up, so there's no known price to attribute it
   * to) -- a day that's only partially before the first fill-up still gets
   * a (partial, underestimated) number rather than null. */
  dayBurnedFuelCost: (number | null)[];
  /** Sum of every stop's actual purchase cost (gallonsPurchased * price). */
  totalFillUpCost: number;
}

/**
 * Simulates fuel range and spend across the whole trip in one pass -- the
 * trip-wide counterpart to DayMap's per-day fuelStopPlan, chaining across
 * day boundaries instead of resetting at each one. Each stop's actual
 * fillStrategy is respected (a "partial" fill only buys enough to reach the
 * next cheaper stop, same as the per-day plan), using the next stop
 * anywhere in the trip -- not just the same day -- to decide whether a
 * cheaper one lies ahead.
 */
export function planTripFuelUsage(
  days: RouteDaySegment[],
  fuelStopsByDay: FuelStopSelection[][],
  vehicle: AutoFuelPlanVehicle,
  initialFuelRangeMiles: number
): TripFuelPlan {
  interface FlatStop {
    dayIndex: number;
    city: string;
    avgPricePerGallon: number;
    fillStrategy?: "full" | "partial";
    absPositionMiles: number;
  }

  const dayStartMiles: number[] = [];
  let cumulativeMiles = 0;
  for (const day of days) {
    dayStartMiles.push(cumulativeMiles);
    cumulativeMiles += metersToMiles(day.distanceMeters);
  }

  const flatStops: FlatStop[] = [];
  fuelStopsByDay.forEach((stops, dayIndex) => {
    const dayMiles = metersToMiles(days[dayIndex]?.distanceMeters ?? 0);
    stops.forEach((stop) => {
      flatStops.push({
        dayIndex,
        city: stop.city,
        avgPricePerGallon: stop.avgPricePerGallon,
        fillStrategy: stop.fillStrategy,
        absPositionMiles: dayStartMiles[dayIndex] + stop.drivingFraction * dayMiles,
      });
    });
  });
  flatStops.sort((a, b) => a.absPositionMiles - b.absPositionMiles);

  const fullTankRangeMiles = vehicle.fuelCapacityGallons * vehicle.gasMileageMpg;

  const startOfDayRangeMiles: number[] = new Array(days.length).fill(0);
  const dayBurnedFuelCost: (number | null)[] = new Array(days.length).fill(null);
  const dayHasPricedMiles: boolean[] = new Array(days.length).fill(false);
  const stopResults: TripFuelPlanStop[] = [];

  let range = initialFuelRangeMiles;
  let currentPricePerGallon: number | null = null;

  days.forEach((day, dayIndex) => {
    startOfDayRangeMiles[dayIndex] = Math.max(0, range);
    let dayCost = 0;
    let prevPosition = dayStartMiles[dayIndex];
    const dayMiles = metersToMiles(day.distanceMeters);

    const consumeSegment = (toPosition: number) => {
      const segmentMiles = toPosition - prevPosition;
      range -= segmentMiles;
      if (currentPricePerGallon !== null) {
        dayCost += (segmentMiles / vehicle.gasMileageMpg) * currentPricePerGallon;
        dayHasPricedMiles[dayIndex] = true;
      }
      prevPosition = toPosition;
    };

    const thisDayStops = flatStops.filter((s) => s.dayIndex === dayIndex);
    thisDayStops.forEach((stop) => {
      consumeSegment(stop.absPositionMiles);

      const arrivalRangeMiles = range;
      const gallonsRemaining = Math.max(0, arrivalRangeMiles) / vehicle.gasMileageMpg;
      const next = flatStops[flatStops.indexOf(stop) + 1];
      const cheaperAhead = !!next && next.avgPricePerGallon < stop.avgPricePerGallon;
      const chosenStrategy: "full" | "partial" =
        cheaperAhead && stop.fillStrategy !== "full" ? "partial" : "full";

      let gallonsPurchased: number;
      let departureRangeMiles: number;
      if (chosenStrategy === "partial" && next) {
        const milesToNext = next.absPositionMiles - stop.absPositionMiles;
        const gallonsNeeded = Math.min(
          vehicle.fuelCapacityGallons,
          (milesToNext + FUEL_RESERVE_MILES) / vehicle.gasMileageMpg
        );
        gallonsPurchased = Math.max(0, gallonsNeeded - gallonsRemaining);
        departureRangeMiles = (gallonsRemaining + gallonsPurchased) * vehicle.gasMileageMpg;
      } else {
        gallonsPurchased = Math.max(0, vehicle.fuelCapacityGallons - gallonsRemaining);
        departureRangeMiles = fullTankRangeMiles;
      }
      const cost = gallonsPurchased * stop.avgPricePerGallon;

      stopResults.push({
        dayIndex,
        city: stop.city,
        arrivalRangeMiles,
        gallonsPurchased,
        cost,
        departureRangeMiles,
      });

      range = departureRangeMiles;
      currentPricePerGallon = stop.avgPricePerGallon;
    });

    consumeSegment(dayStartMiles[dayIndex] + dayMiles);
    dayBurnedFuelCost[dayIndex] = dayHasPricedMiles[dayIndex] ? dayCost : null;
  });

  const totalFillUpCost = stopResults.reduce((sum, r) => sum + r.cost, 0);

  return { stops: stopResults, startOfDayRangeMiles, dayBurnedFuelCost, totalFillUpCost };
}


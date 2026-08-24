"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  Map,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import {
  buildDayItinerary,
  DAY_COLORS,
  findPointAtDistance,
  formatDuration,
  formatMiles,
  formatSecondsAsClockTime,
  getDefaultNumDays,
  getMaxDayOptions,
  getRouteDurationSeconds,
  hasDinnerStop,
  LUNCH_WINDOW_END,
  LUNCH_WINDOW_START,
  milesToMeters,
  secondsAtDrivingFraction,
  splitRouteIntoDays,
  timeStringToSeconds,
  type DayItineraryStop,
  type LunchSelection,
  type RouteDaySegment,
} from "@/lib/routeDays";

/** Picks a point along a day's driving path at a given 0..1 fraction. */
function pointAtFraction(
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
 * fraction — a simple squared-distance nearest-neighbor scan, consistent
 * with the index-based approximations used elsewhere in this file. */
function nearestFractionOnPath(
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
function mapMarkerLabel(label: DayItineraryStop["label"]): string {
  return label === "Departure" || label === "Arrival" ? "Hotel" : label;
}

/** Where to actually place a stop's marker: the selected restaurant's real
 * coordinates for a chosen Lunch stop (its drivingFraction is only an
 * approximation used for ETA/geocoding, not its true location), otherwise
 * the corresponding point along the day's route. */
function markerPosition(
  day: RouteDaySegment,
  stop: DayItineraryStop,
  selectedLunch: LunchSelection | null
): google.maps.LatLngLiteral {
  if (stop.label === "Lunch" && selectedLunch) {
    return { lat: selectedLunch.lat, lng: selectedLunch.lng };
  }
  return pointAtFraction(day, stop.drivingFraction);
}

interface LunchSearchResult {
  placeId: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
}

const LUNCH_WINDOW_START_SECONDS = timeStringToSeconds(LUNCH_WINDOW_START);
const LUNCH_WINDOW_END_SECONDS = timeStringToSeconds(LUNCH_WINDOW_END);

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function RouteMap({
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
  fuelRangeMiles,
  initialLunchChoices,
  onLunchChoicesChange,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
  fuelRangeMiles: number | null;
  initialLunchChoices?: Array<LunchSelection | null>;
  onLunchChoicesChange: (choices: Array<LunchSelection | null>) => void;
}) {
  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-500">
        Google Maps API key not configured — see SETUP.md
      </div>
    );
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <RouteMapInner
        departureLocation={departureLocation}
        destination={destination}
        initialNumDays={initialNumDays}
        onNumDaysChange={onNumDaysChange}
        fuelRangeMiles={fuelRangeMiles}
        initialLunchChoices={initialLunchChoices}
        onLunchChoicesChange={onLunchChoicesChange}
      />
    </APIProvider>
  );
}

function RouteMapInner({
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
  fuelRangeMiles,
  initialLunchChoices,
  onLunchChoicesChange,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
  fuelRangeMiles: number | null;
  initialLunchChoices?: Array<LunchSelection | null>;
  onLunchChoicesChange: (choices: Array<LunchSelection | null>) => void;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const geocodingLibrary = useMapsLibrary("geocoding");
  const geometryLibrary = useMapsLibrary("geometry");

  const [leg, setLeg] = useState<google.maps.DirectionsLeg | null>(null);
  const [numDaysOverride, setNumDaysOverride] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the route once per departure/destination pair.
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const directionsService = new routesLibrary.DirectionsService();

    directionsService
      .route({
        origin: departureLocation,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
      })
      .then((result) => {
        const resultLeg = result.routes[0]?.legs[0];
        if (!resultLeg) {
          setError("Couldn't find a route between these locations.");
          return;
        }
        setLeg(resultLeg);

        const bounds = new google.maps.LatLngBounds();
        resultLeg.steps.forEach((step) =>
          step.path.forEach((point) => bounds.extend(point))
        );
        map.fitBounds(bounds, 40);
      })
      .catch(() => {
        setError("Couldn't calculate a route between these locations.");
      });
  }, [routesLibrary, map, departureLocation, destination]);

  const maxDays = leg ? getMaxDayOptions(getRouteDurationSeconds(leg)) : null;

  // Starting day count: the saved value if there is one and it's still
  // valid for this route, otherwise a sensible default. Once the user
  // picks a value explicitly, that override takes precedence.
  const defaultNumDays = useMemo(() => {
    if (!leg || maxDays === null) return null;
    if (initialNumDays && initialNumDays >= 1 && initialNumDays <= maxDays) {
      return initialNumDays;
    }
    return getDefaultNumDays(getRouteDurationSeconds(leg), maxDays);
  }, [leg, maxDays, initialNumDays]);

  const numDays = numDaysOverride ?? defaultNumDays;

  const days = useMemo(() => {
    if (!leg || !numDays) return null;
    return splitRouteIntoDays(leg, numDays);
  }, [leg, numDays]);

  function handleNumDaysChange(value: number) {
    setNumDaysOverride(value);
    onNumDaysChange(value);
  }

  // Where the car would first need to fill up, based on the current fuel
  // range against the full route (not per-day) — null if no range is
  // entered yet, or the range covers the whole trip.
  const fillUpPoint = useMemo(() => {
    if (!leg || !fuelRangeMiles || fuelRangeMiles <= 0) return null;
    return findPointAtDistance(leg, milesToMeters(fuelRangeMiles));
  }, [leg, fuelRangeMiles]);

  // Whether each day gets an automatic dinner stop.
  const dayHasDinner = useMemo(
    () => days?.map((day) => hasDinnerStop(day.durationSeconds)) ?? null,
    [days]
  );

  // For each day, restaurants found via a search along that day's route,
  // projected onto the route (for an ETA) and filtered to the lunch window,
  // sorted chronologically. Re-runs only when the route/day-split actually
  // changes — not when a lunch choice is toggled.
  const [lunchOptionsByDay, setLunchOptionsByDay] = useState<
    LunchSelection[][] | null
  >(null);

  useEffect(() => {
    if (!days || !dayHasDinner || !geometryLibrary) return;
    let cancelled = false;

    Promise.all(
      days.map(async (day, i): Promise<LunchSelection[]> => {
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
              drivingFraction,
              secondsSinceMidnight: secondsAtDrivingFraction(
                day.durationSeconds,
                dayHasDinner[i],
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
      })
    ).then((results) => {
      if (!cancelled) setLunchOptionsByDay(results);
    });

    return () => {
      cancelled = true;
    };
  }, [days, dayHasDinner, geometryLibrary]);

  // Per-day lunch choice: explicit per-day overrides layered on top of
  // whatever was saved on the trip. Using a plain object (day index -> value)
  // rather than a full array lets a single day's toggle update independently.
  const [lunchChoiceOverrides, setLunchChoiceOverrides] = useState<
    Record<number, LunchSelection | null>
  >({});

  const lunchChoices = useMemo(() => {
    if (!days) return null;
    return days.map((_, i) =>
      i in lunchChoiceOverrides
        ? lunchChoiceOverrides[i]
        : (initialLunchChoices?.[i] ?? null)
    );
  }, [days, lunchChoiceOverrides, initialLunchChoices]);

  function handleLunchChoiceChange(
    dayIndex: number,
    selection: LunchSelection | null
  ) {
    const updated = { ...lunchChoiceOverrides, [dayIndex]: selection };
    setLunchChoiceOverrides(updated);
    if (!days) return;
    const fullChoices = days.map((_, i) =>
      i in updated ? updated[i] : (initialLunchChoices?.[i] ?? null)
    );
    onLunchChoicesChange(fullChoices);
  }

  // The full stop-by-stop itinerary (Departure/Lunch/Dinner/Arrival, each
  // with a clock time and a driving-path fraction) for every day. Shared by
  // the geocoding effect, the map markers, and the day list below so they
  // all agree on exactly the same points.
  const dayItineraries = useMemo(() => {
    if (!days || !dayHasDinner || !lunchChoices) return null;
    return days.map((day, i) => {
      const choice = lunchChoices[i];
      const lunch = choice
        ? {
            drivingFraction: choice.drivingFraction,
            secondsSinceMidnight: choice.secondsSinceMidnight,
          }
        : null;
      return buildDayItinerary(day.durationSeconds, dayHasDinner[i], lunch);
    });
  }, [days, dayHasDinner, lunchChoices]);

  // Boundary points between days: [overall start, end of day 1 (= start of
  // day 2), ..., overall end]. Geocoding just these (numDays + 1 points)
  // instead of two per day avoids re-geocoding the same shared point twice.
  const [boundaryCities, setBoundaryCities] = useState<(string | null)[] | null>(
    null
  );
  // Per day, the dinner stop's city (only meaningful for days with dinner).
  const [dinnerCitiesByDay, setDinnerCitiesByDay] = useState<
    (string | null)[] | null
  >(null);

  useEffect(() => {
    if (!days || !dayItineraries || !geocodingLibrary) return;
    let cancelled = false;
    const geocoder = new geocodingLibrary.Geocoder();

    const geocodeAll = (points: google.maps.LatLngLiteral[]) =>
      Promise.all(
        points.map((point) =>
          geocoder
            .geocode({ location: point })
            .then((response) => extractCityName(response.results[0]))
            .catch(() => null)
        )
      );

    const boundaryPoints = [
      days[0].path[0],
      ...days.map((day) => day.path[day.path.length - 1]),
    ];

    const dinnerDayIndices: number[] = [];
    const dinnerPoints: google.maps.LatLngLiteral[] = [];
    days.forEach((day, i) => {
      const dinnerStop = dayItineraries[i].find((s) => s.label === "Dinner");
      if (dinnerStop) {
        dinnerDayIndices.push(i);
        dinnerPoints.push(pointAtFraction(day, dinnerStop.drivingFraction));
      }
    });

    Promise.all([geocodeAll(boundaryPoints), geocodeAll(dinnerPoints)]).then(
      ([boundaryResults, dinnerResults]) => {
        if (cancelled) return;
        setBoundaryCities(boundaryResults);

        const dinnerCities = days.map(() => null as string | null);
        dinnerDayIndices.forEach((dayIndex, k) => {
          dinnerCities[dayIndex] = dinnerResults[k];
        });
        setDinnerCitiesByDay(dinnerCities);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [days, dayItineraries, geocodingLibrary]);

  return (
    <div className="space-y-3">
      {maxDays !== null && numDays !== null && (
        <div className="flex items-center gap-2">
          <label htmlFor="num-days" className="text-sm font-medium text-slate-700">
            Split into
          </label>
          <select
            id="num-days"
            value={numDays}
            onChange={(e) => handleNumDaysChange(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          >
            {Array.from({ length: maxDays }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} day{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="h-96 overflow-hidden rounded-lg border border-slate-200">
        <Map
          mapId="roadtrip-route-map"
          defaultCenter={{ lat: 39.8283, lng: -98.5795 }}
          defaultZoom={4}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          {days?.map((day, i) => (
            <Polyline
              key={i}
              path={day.path}
              strokeColor={DAY_COLORS[i % DAY_COLORS.length]}
              strokeOpacity={0.9}
              strokeWeight={5}
            />
          ))}
          {days &&
            dayItineraries &&
            lunchChoices &&
            days.map((day, i) =>
              dayItineraries[i].map((stop, stopIndex) => (
                <AdvancedMarker
                  key={`${i}-${stopIndex}`}
                  position={markerPosition(day, stop, lunchChoices[i])}
                  anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                >
                  <div className="relative h-5 w-5">
                    <div
                      className="h-5 w-5 rounded-full border-2 border-white shadow"
                      style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }}
                    />
                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                      {mapMarkerLabel(stop.label)}
                    </span>
                  </div>
                </AdvancedMarker>
              ))
            )}
          {fillUpPoint && (
            <AdvancedMarker
              position={fillUpPoint}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            >
              <div className="relative h-5 w-5">
                <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[11px] shadow">
                  <span aria-hidden>⛽</span>
                </div>
                <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                  Fill up
                </span>
              </div>
            </AdvancedMarker>
          )}
        </Map>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {days && days.length > 0 && dayItineraries && lunchChoices && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {days.map((day, i) => {
            const itinerary = dayItineraries[i];
            const selectedLunch = lunchChoices[i];
            const lunchOptions = lunchOptionsByDay?.[i];

            // Only trust the geocoded city arrays once they match the
            // current day count — they can briefly lag behind `days` after
            // the dropdown changes, while new geocode requests are in
            // flight.
            const boundaryCitiesReady =
              boundaryCities?.length === days.length + 1;
            const dinnerCitiesReady = dinnerCitiesByDay?.length === days.length;

            return (
              <div key={i} className="px-4 py-3 text-sm">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }}
                  />
                  <span className="font-medium text-slate-700">Day {i + 1}</span>
                  <span className="text-slate-400">
                    {formatMiles(day.distanceMeters)} ·{" "}
                    {formatDuration(day.durationSeconds)} driving
                  </span>
                </div>

                <div className="mb-2 space-y-1 pl-5 text-xs text-slate-600">
                  {lunchOptions === undefined && (
                    <p className="text-slate-400">Finding lunch spots…</p>
                  )}
                  {lunchOptions?.length === 0 && (
                    <p className="text-slate-400">
                      No lunch spots found along this leg.
                    </p>
                  )}
                  {lunchOptions?.map((option) => {
                    const checked = selectedLunch?.placeId === option.placeId;
                    return (
                      <label
                        key={option.placeId}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            handleLunchChoiceChange(i, checked ? null : option)
                          }
                        />
                        {option.name} ({option.type}) —{" "}
                        {formatSecondsAsClockTime(option.secondsSinceMidnight)}
                      </label>
                    );
                  })}
                </div>

                <div className="space-y-0.5 pl-5">
                  {itinerary.map((stop, stopIndex) => {
                    let detail: string | null = null;
                    if (stop.label === "Departure") {
                      detail = boundaryCitiesReady ? boundaryCities![i] : null;
                    } else if (stop.label === "Arrival") {
                      detail = boundaryCitiesReady ? boundaryCities![i + 1] : null;
                    } else if (stop.label === "Lunch") {
                      detail = selectedLunch
                        ? `${selectedLunch.name} (${selectedLunch.type})`
                        : null;
                    } else {
                      detail = dinnerCitiesReady ? dinnerCitiesByDay![i] : null;
                    }
                    return (
                      <div
                        key={stopIndex}
                        className="flex items-center justify-between text-slate-500"
                      >
                        <span>
                          {stop.label}
                          {detail ? ` — ${detail}` : ""}
                        </span>
                        <span>{formatSecondsAsClockTime(stop.secondsSinceMidnight)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Pulls a "City, State" label out of a geocoding result, falling back to
 * progressively broader area types for the city part if there's no exact
 * locality (e.g. a point out in the countryside). */
function extractCityName(
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

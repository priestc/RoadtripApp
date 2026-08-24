"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
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
  getRouteDistanceMeters,
  getRouteDurationSeconds,
  hasDinnerStop,
  metersToMiles,
  milesToMeters,
  splitRouteIntoDays,
  type FuelStopSelection,
  type LunchSelection,
} from "@/lib/routeDays";
import {
  extractCityName,
  mapMarkerLabel,
  markerPosition,
  pointAtFraction,
} from "@/lib/routeSearch";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export interface TripVehicle {
  gasMileageMpg: number;
  fuelCapacityGallons: number;
}

/** Icon shown in the itinerary list's leftmost column for a given stop label. */
function stopIcon(label: string): string {
  switch (label) {
    case "Departure":
    case "Arrival":
      return "🏨";
    case "Lunch":
    case "Dinner":
      return "🍽️";
    case "Fuel stop":
      return "⛽";
    default:
      return "📍";
  }
}

export default function RouteMap({
  tripId,
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
  fuelRangeMiles,
  initialLunchChoices,
  initialFuelStopsByDay,
  vehicle,
}: {
  tripId: string;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
  fuelRangeMiles: number | null;
  initialLunchChoices?: Array<LunchSelection | null>;
  initialFuelStopsByDay?: Array<FuelStopSelection[]>;
  vehicle: TripVehicle | null;
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
        tripId={tripId}
        departureLocation={departureLocation}
        destination={destination}
        initialNumDays={initialNumDays}
        onNumDaysChange={onNumDaysChange}
        fuelRangeMiles={fuelRangeMiles}
        initialLunchChoices={initialLunchChoices}
        initialFuelStopsByDay={initialFuelStopsByDay}
        vehicle={vehicle}
      />
    </APIProvider>
  );
}

function RouteMapInner({
  tripId,
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
  fuelRangeMiles,
  initialLunchChoices,
  initialFuelStopsByDay,
  vehicle,
}: {
  tripId: string;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
  fuelRangeMiles: number | null;
  initialLunchChoices?: Array<LunchSelection | null>;
  initialFuelStopsByDay?: Array<FuelStopSelection[]>;
  vehicle: TripVehicle | null;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const geocodingLibrary = useMapsLibrary("geocoding");

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

  // Total fuel for the whole trip's distance -- deliberately not netting
  // out whatever range is already in the tank (that's what fillUpPoint is
  // for), just total gallons the full distance would burn.
  const totalGallonsNeeded = useMemo(() => {
    if (!leg || !vehicle) return null;
    return metersToMiles(getRouteDistanceMeters(leg)) / vehicle.gasMileageMpg;
  }, [leg, vehicle]);

  // Whether each day gets an automatic dinner stop.
  const dayHasDinner = useMemo(
    () => days?.map((day) => hasDinnerStop(day.durationSeconds)) ?? null,
    [days]
  );

  // Lunch and fuel stops are both chosen on each day's own page now -- this
  // trip page only displays whatever was already saved there, never a
  // picker.
  const lunchChoices = useMemo(() => {
    if (!days) return null;
    return days.map((_, i) => initialLunchChoices?.[i] ?? null);
  }, [days, initialLunchChoices]);

  const fuelStopsByDay = useMemo(() => {
    if (!days) return null;
    return days.map((_, i) => initialFuelStopsByDay?.[i] ?? []);
  }, [days, initialFuelStopsByDay]);

  // The full stop-by-stop itinerary (Departure/Lunch/Fuel/Dinner/Arrival,
  // each with a clock time and a driving-path fraction) for every day.
  // Shared by the geocoding effect, the map markers, and the day list below
  // so they all agree on exactly the same points.
  const dayItineraries = useMemo(() => {
    if (!days || !dayHasDinner || !lunchChoices || !fuelStopsByDay) return null;
    return days.map((day, i) => {
      const choice = lunchChoices[i];
      const lunch = choice ? { drivingFraction: choice.drivingFraction } : null;
      const fuelStopFractions = fuelStopsByDay[i].map((s) => s.drivingFraction);
      return buildDayItinerary(day.durationSeconds, dayHasDinner[i], lunch, fuelStopFractions);
    });
  }, [days, dayHasDinner, lunchChoices, fuelStopsByDay]);

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
            fuelStopsByDay &&
            days.map((day, i) =>
              dayItineraries[i].map((stop, stopIndex) => {
                const fuelStop =
                  stop.label === "Fuel" && stop.fuelStopIndex !== undefined
                    ? fuelStopsByDay[i][stop.fuelStopIndex]
                    : undefined;
                const position = fuelStop
                  ? { lat: fuelStop.lat, lng: fuelStop.lng }
                  : markerPosition(day, stop, lunchChoices[i]);
                return (
                  <AdvancedMarker
                    key={`${i}-${stopIndex}`}
                    position={position}
                    anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                  >
                    <div className="relative h-5 w-5">
                      {fuelStop ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[11px] shadow">
                          <span aria-hidden>⛽</span>
                        </div>
                      ) : (
                        <div
                          className="h-5 w-5 rounded-full border-2 border-white shadow"
                          style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }}
                        />
                      )}
                      <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                        {fuelStop ? `Fuel — ${fuelStop.city}` : mapMarkerLabel(stop.label)}
                      </span>
                    </div>
                  </AdvancedMarker>
                );
              })
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

            // Only trust the geocoded city arrays once they match the
            // current day count — they can briefly lag behind `days` after
            // the dropdown changes, while new geocode requests are in
            // flight.
            const boundaryCitiesReady =
              boundaryCities?.length === days.length + 1;
            const dinnerCitiesReady = dinnerCitiesByDay?.length === days.length;

            return (
              <Link
                key={i}
                href={`/trips/${tripId}/days/${i}`}
                className="block px-4 py-3 text-sm transition hover:bg-slate-50"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }}
                  />
                  <span className="font-medium text-slate-700">Day {i + 1}</span>
                  <span className="text-slate-400">
                    {formatMiles(day.distanceMeters)} ·{" "}
                    {formatDuration(day.durationSeconds)} driving
                    {vehicle && (
                      <>
                        {" "}
                        ·{" "}
                        {(() => {
                          const dayGallons =
                            metersToMiles(day.distanceMeters) / vehicle.gasMileageMpg;
                          const tankPercent =
                            (dayGallons / vehicle.fuelCapacityGallons) * 100;
                          return `${dayGallons.toFixed(1)} gal (${tankPercent.toFixed(0)}% of tank)`;
                        })()}
                      </>
                    )}
                  </span>
                </div>

                <div className="pl-5">
                  {(() => {
                    const rows = itinerary.map((stop) => {
                      let detail: string | null = null;
                      if (stop.label === "Departure") {
                        detail = boundaryCitiesReady ? boundaryCities![i] : null;
                      } else if (stop.label === "Arrival") {
                        detail = boundaryCitiesReady ? boundaryCities![i + 1] : null;
                      } else if (stop.label === "Lunch") {
                        detail = selectedLunch
                          ? `${selectedLunch.name} (${selectedLunch.type})${selectedLunch.city ? ` — ${selectedLunch.city}` : ""}`
                          : null;
                      } else if (stop.label === "Dinner") {
                        detail = dinnerCitiesReady ? dinnerCitiesByDay![i] : null;
                      } else if (stop.label === "Fuel" && stop.fuelStopIndex !== undefined) {
                        const fuelStop = fuelStopsByDay?.[i]?.[stop.fuelStopIndex];
                        detail = fuelStop
                          ? `${fuelStop.city} ($${fuelStop.avgPricePerGallon.toFixed(2)}/gal avg)`
                          : null;
                      }
                      return {
                        label: stop.label === "Fuel" ? "Fuel stop" : (stop.label as string),
                        detail,
                        secondsSinceMidnight: stop.secondsSinceMidnight,
                        drivingFraction: stop.drivingFraction as number | null,
                      };
                    });

                    if (!selectedLunch) {
                      rows.push({
                        label: "Lunch",
                        detail: "Not chosen yet — click to pick a spot",
                        secondsSinceMidnight: -1,
                        drivingFraction: null,
                      });
                    }

                    rows.sort((a, b) => a.secondsSinceMidnight - b.secondsSinceMidnight);

                    const elements: ReactNode[] = [];
                    rows.forEach((row, rowIndex) => {
                      if (rowIndex > 0) {
                        const prev = rows[rowIndex - 1];
                        if (prev.drivingFraction !== null && row.drivingFraction !== null) {
                          const legMeters =
                            (row.drivingFraction - prev.drivingFraction) * day.distanceMeters;
                          const legSeconds =
                            (row.drivingFraction - prev.drivingFraction) * day.durationSeconds;
                          elements.push(
                            <div
                              key={`leg-${rowIndex}`}
                              className="grid grid-cols-[20px_1fr] items-center gap-2 py-0.5 text-[11px] text-slate-400"
                            >
                              <span className="text-center">↓</span>
                              <span>
                                {formatMiles(legMeters)} · {formatDuration(legSeconds)}
                              </span>
                            </div>
                          );
                        }
                      }
                      elements.push(
                        <div
                          key={rowIndex}
                          className="grid grid-cols-[20px_1fr_auto] items-center gap-2 py-0.5 text-slate-500"
                        >
                          <span className="text-center text-sm" aria-hidden>
                            {stopIcon(row.label)}
                          </span>
                          <span>
                            {row.label}
                            {row.detail ? ` — ${row.detail}` : ""}
                          </span>
                          {row.secondsSinceMidnight >= 0 && (
                            <span>{formatSecondsAsClockTime(row.secondsSinceMidnight)}</span>
                          )}
                        </div>
                      );
                    });

                    return elements;
                  })()}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {leg && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-700">Fuel for this trip</p>
          {vehicle && totalGallonsNeeded !== null ? (
            <p className="mt-1 text-slate-600">
              {formatMiles(getRouteDistanceMeters(leg))} total — about{" "}
              <span className="font-semibold">
                {totalGallonsNeeded.toFixed(1)} gallons
              </span>{" "}
              at {vehicle.gasMileageMpg} mpg. This is fuel for the entire
              trip&apos;s distance — it doesn&apos;t subtract whatever&apos;s
              already in the tank at the start.
            </p>
          ) : (
            <p className="mt-1 text-slate-400">
              Select a vehicle above to estimate total fuel needed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

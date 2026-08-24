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
  formatDuration,
  formatMiles,
  formatSecondsAsClockTime,
  FUEL_RESERVE_MILES,
  getDefaultNumDays,
  getMaxDayOptions,
  getRouteDurationSeconds,
  hasDinnerStop,
  metersToMiles,
  splitRouteIntoDays,
  type LunchSelection,
  type RouteDaySegment,
} from "@/lib/routeDays";
import {
  extractCityName,
  mapMarkerLabel,
  markerPosition,
  pointAtFraction,
  searchGasForDay,
  searchLunchForDay,
  type CheapestGasStop,
} from "@/lib/routeSearch";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export interface TripVehicle {
  gasMileageMpg: number;
  fuelCapacityGallons: number;
}

export default function DayMap({
  dayIndex,
  departureLocation,
  destination,
  initialNumDays,
  initialLunchChoice,
  onLunchChoiceChange,
  vehicle,
}: {
  dayIndex: number;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  initialLunchChoice: LunchSelection | null;
  onLunchChoiceChange: (choice: LunchSelection | null) => void;
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
      <DayMapInner
        dayIndex={dayIndex}
        departureLocation={departureLocation}
        destination={destination}
        initialNumDays={initialNumDays}
        initialLunchChoice={initialLunchChoice}
        onLunchChoiceChange={onLunchChoiceChange}
        vehicle={vehicle}
      />
    </APIProvider>
  );
}

function DayMapInner({
  dayIndex,
  departureLocation,
  destination,
  initialNumDays,
  initialLunchChoice,
  onLunchChoiceChange,
  vehicle,
}: {
  dayIndex: number;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  initialLunchChoice: LunchSelection | null;
  onLunchChoiceChange: (choice: LunchSelection | null) => void;
  vehicle: TripVehicle | null;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const geocodingLibrary = useMapsLibrary("geocoding");
  const geometryLibrary = useMapsLibrary("geometry");

  const [leg, setLeg] = useState<google.maps.DirectionsLeg | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routesLibrary) return;

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
      })
      .catch(() => {
        setError("Couldn't calculate a route between these locations.");
      });
  }, [routesLibrary, departureLocation, destination]);

  const maxDays = leg ? getMaxDayOptions(getRouteDurationSeconds(leg)) : null;

  const numDays = useMemo(() => {
    if (!leg || maxDays === null) return null;
    if (initialNumDays && initialNumDays >= 1 && initialNumDays <= maxDays) {
      return initialNumDays;
    }
    return getDefaultNumDays(getRouteDurationSeconds(leg), maxDays);
  }, [leg, maxDays, initialNumDays]);

  const days = useMemo(() => {
    if (!leg || !numDays) return null;
    return splitRouteIntoDays(leg, numDays);
  }, [leg, numDays]);

  const day: RouteDaySegment | null =
    days && dayIndex >= 0 && dayIndex < days.length ? days[dayIndex] : null;

  useEffect(() => {
    if (!day || !map) return;
    const bounds = new google.maps.LatLngBounds();
    day.path.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 40);
  }, [day, map]);

  const dayHasDinner = day ? hasDinnerStop(day.durationSeconds) : null;

  const [lunchOptions, setLunchOptions] = useState<LunchSelection[] | null>(null);
  useEffect(() => {
    if (!day || dayHasDinner === null || !geometryLibrary) return;
    let cancelled = false;
    searchLunchForDay(geometryLibrary, day, dayHasDinner).then((results) => {
      if (!cancelled) setLunchOptions(results);
    });
    return () => {
      cancelled = true;
    };
  }, [day, dayHasDinner, geometryLibrary]);

  const [gasInfo, setGasInfo] = useState<{
    cheapest: CheapestGasStop | null;
    average: number | null;
  } | null>(null);
  useEffect(() => {
    if (!day || dayHasDinner === null || !geometryLibrary) return;
    let cancelled = false;
    searchGasForDay(geometryLibrary, day, dayHasDinner).then((result) => {
      if (!cancelled) setGasInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, [day, dayHasDinner, geometryLibrary]);

  // Current fuel range, entered fresh on each visit to this day (not
  // persisted -- it changes daily and isn't meaningful outside this page).
  const [fuelRangeInput, setFuelRangeInput] = useState("");
  const parsedFuelRange = Number(fuelRangeInput);
  const fuelRangeMiles =
    fuelRangeInput.trim() !== "" && !Number.isNaN(parsedFuelRange) && parsedFuelRange > 0
      ? parsedFuelRange
      : null;

  // Fraction of the day's route reachable before dropping into the fixed
  // reserve buffer -- null if no range has been entered yet.
  const maxDrivingFraction = useMemo(() => {
    if (!day || fuelRangeMiles === null) return null;
    const dayMiles = metersToMiles(day.distanceMeters);
    if (dayMiles <= 0) return 1;
    const reachableMiles = Math.max(0, fuelRangeMiles - FUEL_RESERVE_MILES);
    return Math.min(1, reachableMiles / dayMiles);
  }, [day, fuelRangeMiles]);

  // Undefined = not fetched (or not applicable) yet, null = fetched but
  // nothing reachable, otherwise the cheapest reachable stop. Only
  // meaningful when maxDrivingFraction is a positive number -- render logic
  // below ignores a stale value from a previous fuel range otherwise.
  const [reachableGas, setReachableGas] = useState<CheapestGasStop | null | undefined>(
    undefined
  );
  useEffect(() => {
    if (
      !day ||
      dayHasDinner === null ||
      !geometryLibrary ||
      maxDrivingFraction === null ||
      maxDrivingFraction <= 0
    ) {
      return;
    }
    let cancelled = false;
    searchGasForDay(geometryLibrary, day, dayHasDinner, maxDrivingFraction).then(
      (result) => {
        if (!cancelled) setReachableGas(result.cheapest);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [day, dayHasDinner, geometryLibrary, maxDrivingFraction]);

  const itinerary = useMemo(() => {
    if (!day || dayHasDinner === null) return null;
    const lunch = initialLunchChoice
      ? {
          drivingFraction: initialLunchChoice.drivingFraction,
          secondsSinceMidnight: initialLunchChoice.secondsSinceMidnight,
        }
      : null;
    return buildDayItinerary(day.durationSeconds, dayHasDinner, lunch);
  }, [day, dayHasDinner, initialLunchChoice]);

  const [boundaryCities, setBoundaryCities] = useState<{
    start: string | null;
    end: string | null;
  } | null>(null);
  const [dinnerCity, setDinnerCity] = useState<string | null>(null);

  useEffect(() => {
    if (!day || !itinerary || !geocodingLibrary) return;
    let cancelled = false;
    const geocoder = new geocodingLibrary.Geocoder();

    const geocodeOne = (point: google.maps.LatLngLiteral) =>
      geocoder
        .geocode({ location: point })
        .then((response) => extractCityName(response.results[0]))
        .catch(() => null);

    const dinnerStop = itinerary.find((s) => s.label === "Dinner");

    Promise.all([
      geocodeOne(day.path[0]),
      geocodeOne(day.path[day.path.length - 1]),
      dinnerStop
        ? geocodeOne(pointAtFraction(day, dinnerStop.drivingFraction))
        : Promise.resolve(null),
    ]).then(([start, end, dinner]) => {
      if (cancelled) return;
      setBoundaryCities({ start, end });
      setDinnerCity(dinner);
    });

    return () => {
      cancelled = true;
    };
  }, [day, itinerary, geocodingLibrary]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!day || dayHasDinner === null || !itinerary) {
    return <p className="text-sm text-slate-500">Loading day…</p>;
  }

  const color = DAY_COLORS[dayIndex % DAY_COLORS.length];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label
          htmlFor="fuel-range"
          className="block text-sm font-medium text-slate-700"
        >
          Current fuel range (mi)
        </label>
        <input
          id="fuel-range"
          type="number"
          min={0}
          step={1}
          placeholder="e.g. 150"
          value={fuelRangeInput}
          onChange={(e) => setFuelRangeInput(e.target.value)}
          className="mt-1 w-36 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
        />
        {fuelRangeMiles !== null && (
          <p className="mt-2 text-xs text-slate-600">
            {maxDrivingFraction !== null && maxDrivingFraction <= 0
              ? `You're already within your ${FUEL_RESERVE_MILES}-mile reserve — refuel before continuing.`
              : reachableGas === undefined
                ? "Checking for gas within your range…"
                : reachableGas
                  ? `Cheapest gas within range: ${reachableGas.city} ($${reachableGas.avgPricePerGallon.toFixed(2)}/gal avg), arriving around ${formatSecondsAsClockTime(reachableGas.secondsSinceMidnight)}`
                  : `No gas stations found before you'd hit your ${FUEL_RESERVE_MILES}-mile reserve.`}
          </p>
        )}
      </div>

      <div className="h-80 overflow-hidden rounded-lg border border-slate-200">
        <Map
          mapId="roadtrip-day-map"
          defaultCenter={day.path[0]}
          defaultZoom={8}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          <Polyline
            path={day.path}
            strokeColor={color}
            strokeOpacity={0.9}
            strokeWeight={5}
          />
          {itinerary.map((stop, stopIndex) => (
            <AdvancedMarker
              key={stopIndex}
              position={markerPosition(day, stop, initialLunchChoice)}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            >
              <div className="relative h-5 w-5">
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: color }}
                />
                <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                  {mapMarkerLabel(stop.label)}
                </span>
              </div>
            </AdvancedMarker>
          ))}
          {gasInfo?.cheapest && (
            <AdvancedMarker
              position={{ lat: gasInfo.cheapest.lat, lng: gasInfo.cheapest.lng }}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            >
              <div className="relative h-5 w-5">
                <div
                  className="h-5 w-5 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: color }}
                />
                <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                  Cheapest gas
                </span>
              </div>
            </AdvancedMarker>
          )}
          {maxDrivingFraction !== null && maxDrivingFraction > 0 && reachableGas && (
            <AdvancedMarker
              position={{ lat: reachableGas.lat, lng: reachableGas.lng }}
              anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            >
              <div className="relative h-5 w-5">
                <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[11px] shadow">
                  <span aria-hidden>⛽</span>
                </div>
                <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                  Gas within range
                </span>
              </div>
            </AdvancedMarker>
          )}
        </Map>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="mb-1 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="font-medium text-slate-700">
            {formatMiles(day.distanceMeters)} · {formatDuration(day.durationSeconds)}{" "}
            driving
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
        {gasInfo?.average != null && (
          <p className="text-xs text-slate-600">
            Avg gas along this leg: ${gasInfo.average.toFixed(2)}/gal
          </p>
        )}

        <div className="mt-3 space-y-0.5">
          {(() => {
            const rows = itinerary
              .filter((stop) => stop.label !== "Lunch" || initialLunchChoice)
              .map((stop) => {
                let detail: string | null = null;
                if (stop.label === "Departure") detail = boundaryCities?.start ?? null;
                else if (stop.label === "Arrival") detail = boundaryCities?.end ?? null;
                else if (stop.label === "Lunch")
                  detail = initialLunchChoice
                    ? `${initialLunchChoice.name} (${initialLunchChoice.type})${initialLunchChoice.city ? ` — ${initialLunchChoice.city}` : ""}`
                    : null;
                else detail = dinnerCity;
                return {
                  label: stop.label as string,
                  detail,
                  secondsSinceMidnight: stop.secondsSinceMidnight,
                };
              });

            if (gasInfo?.cheapest) {
              rows.push({
                label: "Cheapest gas",
                detail: `${gasInfo.cheapest.city} ($${gasInfo.cheapest.avgPricePerGallon.toFixed(2)}/gal avg)`,
                secondsSinceMidnight: gasInfo.cheapest.secondsSinceMidnight,
              });
            }

            rows.sort((a, b) => a.secondsSinceMidnight - b.secondsSinceMidnight);

            return rows.map((row, i) => (
              <div key={i} className="flex items-center justify-between text-slate-500">
                <span>
                  {row.label}
                  {row.detail ? ` — ${row.detail}` : ""}
                </span>
                <span>{formatSecondsAsClockTime(row.secondsSinceMidnight)}</span>
              </div>
            ));
          })()}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-medium text-slate-700">
          Choose a lunch spot
        </p>
        {lunchOptions === null ? (
          <p className="text-sm text-slate-400">Searching restaurants along this leg…</p>
        ) : lunchOptions.length === 0 ? (
          <p className="text-sm text-slate-400">
            No restaurants found along this leg during the lunch window.
          </p>
        ) : (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="radio"
                name="lunch-choice"
                checked={!initialLunchChoice}
                onChange={() => onLunchChoiceChange(null)}
              />
              None
            </label>
            {lunchOptions.map((option) => (
              <label
                key={option.placeId}
                className="flex items-center justify-between gap-2 text-sm text-slate-600"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="lunch-choice"
                    checked={initialLunchChoice?.placeId === option.placeId}
                    onChange={() => onLunchChoiceChange(option)}
                  />
                  {option.name}{" "}
                  <span className="text-xs text-slate-400">
                    ({option.type}
                    {option.city ? ` — ${option.city}` : ""})
                  </span>
                </span>
                <span className="text-xs text-slate-400">
                  {formatSecondsAsClockTime(option.secondsSinceMidnight)}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  Marker,
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
  getDefaultNumDays,
  getMaxDayOptions,
  getMealStops,
  getRouteDurationSeconds,
  splitRouteIntoDays,
} from "@/lib/routeDays";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function RouteMap({
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
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
      />
    </APIProvider>
  );
}

function RouteMapInner({
  departureLocation,
  destination,
  initialNumDays,
  onNumDaysChange,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  onNumDaysChange: (numDays: number) => void;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const geocodingLibrary = useMapsLibrary("geocoding");

  const [leg, setLeg] = useState<google.maps.DirectionsLeg | null>(null);
  const [numDaysOverride, setNumDaysOverride] = useState<number | null>(null);
  const [endpoints, setEndpoints] = useState<{
    start: google.maps.LatLngLiteral;
    end: google.maps.LatLngLiteral;
  } | null>(null);
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
        setEndpoints({
          start: {
            lat: resultLeg.start_location.lat(),
            lng: resultLeg.start_location.lng(),
          },
          end: {
            lat: resultLeg.end_location.lat(),
            lng: resultLeg.end_location.lng(),
          },
        });

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

  // Which meal stops each day gets — kept as its own memo (rather than
  // recomputed inline) so the geocoding effect and the render below always
  // agree on the exact same itinerary shape.
  const dayMealStops = useMemo(
    () => days?.map((day) => getMealStops(day.durationSeconds)) ?? null,
    [days]
  );

  // Boundary points between days: [overall start, end of day 1 (= start of
  // day 2), ..., overall end]. Geocoding just these (numDays + 1 points)
  // instead of two per day avoids re-geocoding the same shared point twice.
  const [boundaryCities, setBoundaryCities] = useState<(string | null)[] | null>(
    null
  );
  // Per day, one city name per meal stop, in the same order as that day's
  // meal stops (e.g. [lunchCity] or [lunchCity, dinnerCity]).
  const [mealCitiesByDay, setMealCitiesByDay] = useState<
    (string | null)[][] | null
  >(null);

  useEffect(() => {
    if (!days || !dayMealStops || !geocodingLibrary) return;
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

    const mealPointsByDay = days.map((day, i) => {
      const itinerary = buildDayItinerary(day.durationSeconds, dayMealStops[i]);
      return itinerary
        .filter((stop) => stop.label === "Lunch" || stop.label === "Dinner")
        .map((stop) => {
          const pathIndex = Math.min(
            Math.max(Math.round(stop.drivingFraction * (day.path.length - 1)), 0),
            day.path.length - 1
          );
          return day.path[pathIndex];
        });
    });

    Promise.all([
      geocodeAll(boundaryPoints),
      Promise.all(mealPointsByDay.map((points) => geocodeAll(points))),
    ]).then(([boundaryResults, mealResults]) => {
      if (cancelled) return;
      setBoundaryCities(boundaryResults);
      setMealCitiesByDay(mealResults);
    });

    return () => {
      cancelled = true;
    };
  }, [days, dayMealStops, geocodingLibrary]);

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
          {endpoints && (
            <>
              <Marker position={endpoints.start} label="A" />
              <Marker position={endpoints.end} label="B" />
            </>
          )}
        </Map>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {days && days.length > 0 && dayMealStops && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {days.map((day, i) => {
            const mealStops = dayMealStops[i];
            const itinerary = buildDayItinerary(day.durationSeconds, mealStops);

            // Only trust the geocoded city arrays once they match the
            // current day count — they can briefly lag behind `days` after
            // the dropdown changes, while new geocode requests are in
            // flight.
            const boundaryCitiesReady =
              boundaryCities?.length === days.length + 1;
            const mealCitiesReady = mealCitiesByDay?.length === days.length;

            let mealIndex = 0;

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
                <div className="space-y-0.5 pl-5">
                  {itinerary.map((stop, stopIndex) => {
                    let city: string | null = null;
                    if (stop.label === "Departure") {
                      city = boundaryCitiesReady ? boundaryCities![i] : null;
                    } else if (stop.label === "Arrival") {
                      city = boundaryCitiesReady ? boundaryCities![i + 1] : null;
                    } else {
                      city = mealCitiesReady
                        ? mealCitiesByDay![i][mealIndex]
                        : null;
                      mealIndex += 1;
                    }
                    return (
                      <div
                        key={stopIndex}
                        className="flex items-center justify-between text-slate-500"
                      >
                        <span>
                          {stop.label}
                          {city ? ` — ${city}` : ""}
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

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
  DAY_COLORS,
  estimateDayWindow,
  formatDuration,
  formatMiles,
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

      {days && days.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {days.map((day, i) => {
            const { start, end } = estimateDayWindow(day.durationSeconds);
            const mealStops = getMealStops(day.durationSeconds);
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: DAY_COLORS[i % DAY_COLORS.length] }}
                  />
                  <span className="font-medium text-slate-700">Day {i + 1}</span>
                  {mealStops.map((meal) => (
                    <span
                      key={meal}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                    >
                      {meal}
                    </span>
                  ))}
                </div>
                <div className="flex gap-4 text-slate-500">
                  <span>{formatMiles(day.distanceMeters)}</span>
                  <span>{formatDuration(day.durationSeconds)} driving</span>
                  <span>
                    {start} – {end}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
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
  splitRouteIntoDays,
  type RouteDaySegment,
} from "@/lib/routeDays";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function RouteMap({
  departureLocation,
  destination,
  maxDrivingHoursPerDay,
  earliestDepartureTime,
}: {
  departureLocation: string;
  destination: string;
  maxDrivingHoursPerDay: number;
  earliestDepartureTime: string;
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
        maxDrivingHoursPerDay={maxDrivingHoursPerDay}
        earliestDepartureTime={earliestDepartureTime}
      />
    </APIProvider>
  );
}

function RouteMapInner({
  departureLocation,
  destination,
  maxDrivingHoursPerDay,
  earliestDepartureTime,
}: {
  departureLocation: string;
  destination: string;
  maxDrivingHoursPerDay: number;
  earliestDepartureTime: string;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");

  const [days, setDays] = useState<RouteDaySegment[] | null>(null);
  const [endpoints, setEndpoints] = useState<{
    start: google.maps.LatLngLiteral;
    end: google.maps.LatLngLiteral;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const leg = result.routes[0]?.legs[0];
        if (!leg) {
          setError("Couldn't find a route between these locations.");
          return;
        }
        setDays(splitRouteIntoDays(leg, maxDrivingHoursPerDay));
        setEndpoints({
          start: { lat: leg.start_location.lat(), lng: leg.start_location.lng() },
          end: { lat: leg.end_location.lat(), lng: leg.end_location.lng() },
        });

        const bounds = new google.maps.LatLngBounds();
        leg.steps.forEach((step) =>
          step.path.forEach((point) => bounds.extend(point))
        );
        map.fitBounds(bounds, 40);
      })
      .catch(() => {
        setError("Couldn't calculate a route between these locations.");
      });
  }, [routesLibrary, map, departureLocation, destination, maxDrivingHoursPerDay]);

  return (
    <div className="space-y-3">
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
            const { start, end } = estimateDayWindow(
              earliestDepartureTime,
              day.durationSeconds
            );
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

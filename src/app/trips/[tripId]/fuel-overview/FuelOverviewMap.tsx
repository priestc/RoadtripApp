"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  InfoWindow,
  Map,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import {
  DAY_COLORS,
  getDefaultNumDays,
  getMaxDayOptions,
  getRouteDurationSeconds,
  hasDinnerStop,
  splitRouteIntoDays,
} from "@/lib/routeDays";
import { gasPriceColor, searchGasForTrip, type TripGasStation } from "@/lib/routeSearch";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** How many rows to show in each of the "most expensive" / "cheapest"
 * tables -- capped so a long trip with dozens of stations still gives a
 * readable, focused summary. */
const TABLE_ROWS = 10;

export default function FuelOverviewMap({
  departureLocation,
  destination,
  initialNumDays,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
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
      <FuelOverviewMapInner
        departureLocation={departureLocation}
        destination={destination}
        initialNumDays={initialNumDays}
      />
    </APIProvider>
  );
}

function FuelOverviewMapInner({
  departureLocation,
  destination,
  initialNumDays,
}: {
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
}) {
  const map = useMap();
  const routesLibrary = useMapsLibrary("routes");
  const geometryLibrary = useMapsLibrary("geometry");

  const [leg, setLeg] = useState<google.maps.DirectionsLeg | null>(null);
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

  const numDays = useMemo(() => {
    if (!leg) return null;
    const maxDays = getMaxDayOptions(getRouteDurationSeconds(leg));
    if (initialNumDays && initialNumDays >= 1 && initialNumDays <= maxDays) {
      return initialNumDays;
    }
    return getDefaultNumDays(getRouteDurationSeconds(leg), maxDays);
  }, [leg, initialNumDays]);

  const days = useMemo(() => {
    if (!leg || !numDays) return null;
    return splitRouteIntoDays(leg, numDays);
  }, [leg, numDays]);

  const dayHasDinner = useMemo(
    () => days?.map((day) => hasDinnerStop(day.durationSeconds)) ?? null,
    [days]
  );

  const [stations, setStations] = useState<TripGasStation[] | null>(null);
  useEffect(() => {
    if (!days || !dayHasDinner || !geometryLibrary) return;
    let cancelled = false;
    searchGasForTrip(geometryLibrary, days, dayHasDinner).then((results) => {
      if (!cancelled) setStations(results);
    });
    return () => {
      cancelled = true;
    };
  }, [days, dayHasDinner, geometryLibrary]);

  const [openStationId, setOpenStationId] = useState<string | null>(null);

  const priceRange = useMemo(() => {
    if (!stations || stations.length === 0) return null;
    const prices = stations.map((s) => s.avgPricePerGallon);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [stations]);

  const sortedByPrice = useMemo(
    () => (stations ? [...stations].sort((a, b) => a.avgPricePerGallon - b.avgPricePerGallon) : null),
    [stations]
  );
  const cheapest = sortedByPrice?.slice(0, TABLE_ROWS) ?? [];
  const priciest = sortedByPrice ? [...sortedByPrice].reverse().slice(0, TABLE_ROWS) : [];

  return (
    <div className="space-y-4">
      <div className="h-96 overflow-hidden rounded-lg border border-slate-200">
        <Map
          mapId="roadtrip-fuel-overview-map"
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
          {stations &&
            priceRange &&
            stations.map((station) => (
              <AdvancedMarker
                key={`${station.dayIndex}-${station.city}`}
                position={{ lat: station.lat, lng: station.lng }}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                onClick={() => setOpenStationId(`${station.dayIndex}-${station.city}`)}
              >
                <div
                  className="h-4 w-4 cursor-pointer rounded-full border-2 border-white shadow"
                  style={{
                    backgroundColor: gasPriceColor(
                      station.avgPricePerGallon,
                      priceRange.min,
                      priceRange.max
                    ),
                  }}
                />
              </AdvancedMarker>
            ))}
          {stations &&
            openStationId &&
            (() => {
              const station = stations.find(
                (s) => `${s.dayIndex}-${s.city}` === openStationId
              );
              if (!station) return null;
              return (
                <InfoWindow
                  position={{ lat: station.lat, lng: station.lng }}
                  onCloseClick={() => setOpenStationId(null)}
                >
                  <div className="p-1 text-sm">
                    <p className="font-medium text-slate-700">{station.city}</p>
                    <p className="text-slate-600">
                      ${station.avgPricePerGallon.toFixed(2)}/gal · Day{" "}
                      {station.dayIndex + 1}
                    </p>
                  </div>
                </InfoWindow>
              );
            })()}
        </Map>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!error && stations === null && (
        <p className="text-sm text-slate-400">
          Searching for gas prices along the whole route…
        </p>
      )}

      {stations && stations.length === 0 && (
        <p className="text-sm text-slate-400">
          No gas prices found along this route.
        </p>
      )}

      {stations && stations.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FuelPriceTable
            title="Most expensive stretches"
            rows={priciest}
            totalCount={stations.length}
          />
          <FuelPriceTable
            title="Cheapest stretches"
            rows={cheapest}
            totalCount={stations.length}
          />
        </div>
      )}
    </div>
  );
}

function FuelPriceTable({
  title,
  rows,
  totalCount,
}: {
  title: string;
  rows: TripGasStation[];
  totalCount: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">
        {title}
        {totalCount > rows.length && (
          <span className="ml-1 font-normal text-slate-400">
            (top {rows.length} of {totalCount})
          </span>
        )}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="pb-1 font-medium">City</th>
            <th className="pb-1 font-medium">Day</th>
            <th className="pb-1 pr-1 text-right font-medium">$/gal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.dayIndex}-${row.city}`}
              className="border-b border-slate-50 last:border-0"
            >
              <td className="py-1 pr-2 text-slate-700">{row.city}</td>
              <td className="py-1 pr-2 text-slate-500">{row.dayIndex + 1}</td>
              <td className="py-1 pr-1 text-right font-medium text-slate-700">
                ${row.avgPricePerGallon.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

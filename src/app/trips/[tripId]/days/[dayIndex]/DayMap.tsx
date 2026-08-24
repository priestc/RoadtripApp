"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  type FuelStopSelection,
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

/** Green for the cheapest price in the set, red for the priciest, and a
 * hue-interpolated color in between for everything else. */
function gasPriceColor(price: number, min: number, max: number): string {
  const fraction = max > min ? (price - min) / (max - min) : 0;
  const hue = 120 - fraction * 120;
  return `hsl(${hue}, 70%, 45%)`;
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
  initialFuelStops,
  onFuelStopsChange,
  vehicle,
}: {
  dayIndex: number;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  initialLunchChoice: LunchSelection | null;
  onLunchChoiceChange: (choice: LunchSelection | null) => void;
  initialFuelStops: FuelStopSelection[];
  onFuelStopsChange: (stops: FuelStopSelection[]) => void;
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
        initialFuelStops={initialFuelStops}
        onFuelStopsChange={onFuelStopsChange}
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
  initialFuelStops,
  onFuelStopsChange,
  vehicle,
}: {
  dayIndex: number;
  departureLocation: string;
  destination: string;
  initialNumDays?: number;
  initialLunchChoice: LunchSelection | null;
  onLunchChoiceChange: (choice: LunchSelection | null) => void;
  initialFuelStops: FuelStopSelection[];
  onFuelStopsChange: (stops: FuelStopSelection[]) => void;
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
    byCity: CheapestGasStop[];
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

  // Which set of markers the map currently shows.
  const [markerMode, setMarkerMode] = useState<"stops" | "gas">("stops");
  // City whose "add fuel stop" popup is currently open, in Gas mode.
  const [openGasCity, setOpenGasCity] = useState<string | null>(null);

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

  // How much fuel would be left when reaching the cheapest reachable gas
  // stop, and what topping back off to a full tank would cost there.
  const arrivalFuelInfo = useMemo(() => {
    if (!day || !vehicle || !reachableGas || fuelRangeMiles === null) return null;
    const distanceToStationMiles =
      reachableGas.drivingFraction * metersToMiles(day.distanceMeters);
    const milesRemaining = Math.max(0, fuelRangeMiles - distanceToStationMiles);
    const gallonsRemaining = milesRemaining / vehicle.gasMileageMpg;
    const tankPercent = (gallonsRemaining / vehicle.fuelCapacityGallons) * 100;
    const gallonsToFill = Math.max(0, vehicle.fuelCapacityGallons - gallonsRemaining);
    const fillUpCost = gallonsToFill * reachableGas.avgPricePerGallon;
    return { rangeMiles: milesRemaining, gallonsRemaining, tankPercent, fillUpCost };
  }, [day, vehicle, reachableGas, fuelRangeMiles]);

  // For each added fuel stop (in route order), how much fuel is left on
  // arrival, what a full fill-up there would cost, and -- when the next
  // fuel stop down the road is cheaper -- how many gallons to buy here to
  // just reach that next stop with the fixed reserve left, rather than
  // topping all the way off at the pricier stop. Which of those two the
  // plan actually assumes (chosenStrategy) follows the stop's own
  // fillStrategy choice when set (via the checkboxes below), defaulting to
  // the recommended one (partial when cheaper stop follows, full
  // otherwise) -- this choice is what determines the next stop's starting
  // range, so it has to be resolved before moving on to it.
  const fuelStopPlan = useMemo(() => {
    if (!day || !vehicle || fuelRangeMiles === null || initialFuelStops.length === 0) {
      return null;
    }
    const dayMiles = metersToMiles(day.distanceMeters);
    const sorted = [...initialFuelStops].sort((a, b) => a.drivingFraction - b.drivingFraction);

    const plan: Record<
      string,
      {
        unreachable: boolean;
        arrivalRangeMiles: number;
        gallonsRemaining: number;
        tankPercent: number;
        fillUpCost: number;
        cheaperAhead: boolean;
        gallonsToBuyForNextCheaper: number | null;
        chosenStrategy: "full" | "partial";
      }
    > = {};

    let rangeMiles = fuelRangeMiles;
    let prevMiles = 0;

    sorted.forEach((stop, i) => {
      const milesFromStart = stop.drivingFraction * dayMiles;
      // Only the first stop's reachability depends on the entered range --
      // every later stop is assumed reachable, since the plan always buys
      // (or assumes) enough fuel at the prior stop to get there.
      const unreachable = i === 0 && milesFromStart > fuelRangeMiles - FUEL_RESERVE_MILES;
      rangeMiles = Math.max(0, rangeMiles - (milesFromStart - prevMiles));
      const arrivalRangeMiles = rangeMiles;

      const gallonsRemaining = rangeMiles / vehicle.gasMileageMpg;
      const tankPercent = (gallonsRemaining / vehicle.fuelCapacityGallons) * 100;
      const fillUpCost =
        Math.max(0, vehicle.fuelCapacityGallons - gallonsRemaining) * stop.avgPricePerGallon;

      const next = sorted[i + 1];
      const cheaperAhead = !!next && next.avgPricePerGallon < stop.avgPricePerGallon;

      let gallonsToBuyForNextCheaper: number | null = null;
      if (cheaperAhead && next) {
        const milesToNext = next.drivingFraction * dayMiles - milesFromStart;
        const gallonsNeeded = Math.min(
          vehicle.fuelCapacityGallons,
          (milesToNext + FUEL_RESERVE_MILES) / vehicle.gasMileageMpg
        );
        gallonsToBuyForNextCheaper = Math.max(0, gallonsNeeded - gallonsRemaining);
      }

      const chosenStrategy: "full" | "partial" =
        cheaperAhead && stop.fillStrategy !== "full" ? "partial" : "full";

      if (chosenStrategy === "partial" && gallonsToBuyForNextCheaper !== null) {
        rangeMiles = (gallonsRemaining + gallonsToBuyForNextCheaper) * vehicle.gasMileageMpg;
      } else {
        rangeMiles = vehicle.fuelCapacityGallons * vehicle.gasMileageMpg;
      }

      plan[stop.city] = {
        unreachable,
        arrivalRangeMiles,
        gallonsRemaining,
        tankPercent,
        fillUpCost,
        cheaperAhead,
        gallonsToBuyForNextCheaper,
        chosenStrategy,
      };
      prevMiles = milesFromStart;
    });

    return plan;
  }, [day, vehicle, fuelRangeMiles, initialFuelStops]);

  function handleFillStrategyChange(city: string, fillStrategy: "full" | "partial") {
    onFuelStopsChange(
      initialFuelStops.map((s) => (s.city === city ? { ...s, fillStrategy } : s))
    );
  }

  const itinerary = useMemo(() => {
    if (!day || dayHasDinner === null) return null;
    const lunch = initialLunchChoice
      ? { drivingFraction: initialLunchChoice.drivingFraction }
      : null;
    const fuelStopFractions = initialFuelStops.map((s) => s.drivingFraction);
    return buildDayItinerary(day.durationSeconds, dayHasDinner, lunch, fuelStopFractions);
  }, [day, dayHasDinner, initialLunchChoice, initialFuelStops]);

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

  const dayGallons = vehicle
    ? metersToMiles(day.distanceMeters) / vehicle.gasMileageMpg
    : null;
  const tankPercent =
    dayGallons != null && vehicle ? (dayGallons / vehicle.fuelCapacityGallons) * 100 : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xl font-semibold text-slate-800">
          {formatMiles(day.distanceMeters)} · {formatDuration(day.durationSeconds)} driving
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMarkerMode("stops");
            setOpenGasCity(null);
          }}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
            markerMode === "stops"
              ? "border-slate-700 bg-slate-700 text-white"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Stops
        </button>
        <button
          type="button"
          onClick={() => setMarkerMode("gas")}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
            markerMode === "gas"
              ? "border-slate-700 bg-slate-700 text-white"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Gas
        </button>
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
          {markerMode === "stops" &&
            itinerary.map((stop, stopIndex) => {
              const fuelStop =
                stop.label === "Fuel" && stop.fuelStopIndex !== undefined
                  ? initialFuelStops[stop.fuelStopIndex]
                  : undefined;
              const position = fuelStop
                ? { lat: fuelStop.lat, lng: fuelStop.lng }
                : markerPosition(day, stop, initialLunchChoice);
              return (
                <AdvancedMarker
                  key={stopIndex}
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
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                      {fuelStop ? `Fuel — ${fuelStop.city}` : mapMarkerLabel(stop.label)}
                    </span>
                  </div>
                </AdvancedMarker>
              );
            })}
          {markerMode === "gas" &&
            gasInfo &&
            gasInfo.byCity.length > 0 &&
            (() => {
              const prices = gasInfo.byCity.map((c) => c.avgPricePerGallon);
              const min = Math.min(...prices);
              const max = Math.max(...prices);
              return gasInfo.byCity.map((cityStop) => (
                <AdvancedMarker
                  key={cityStop.city}
                  position={{ lat: cityStop.lat, lng: cityStop.lng }}
                  anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                  onClick={() => setOpenGasCity(cityStop.city)}
                >
                  <div className="relative h-5 w-5 cursor-pointer">
                    <div
                      className="h-5 w-5 rounded-full border-2 border-white shadow"
                      style={{
                        backgroundColor: gasPriceColor(cityStop.avgPricePerGallon, min, max),
                      }}
                    />
                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 py-0.5 text-[10px] font-medium text-slate-700 shadow">
                      {cityStop.city} — ${cityStop.avgPricePerGallon.toFixed(2)}
                    </span>
                  </div>
                </AdvancedMarker>
              ));
            })()}
          {markerMode === "gas" &&
            gasInfo &&
            openGasCity &&
            (() => {
              const cityStop = gasInfo.byCity.find((c) => c.city === openGasCity);
              if (!cityStop) return null;
              const isSelected = initialFuelStops.some((s) => s.city === cityStop.city);
              return (
                <InfoWindow
                  position={{ lat: cityStop.lat, lng: cityStop.lng }}
                  onCloseClick={() => setOpenGasCity(null)}
                >
                  <div className="p-1 text-sm">
                    <p className="mb-2 font-medium text-slate-700">
                      {cityStop.city} — ${cityStop.avgPricePerGallon.toFixed(2)}/gal
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onFuelStopsChange(
                          isSelected
                            ? initialFuelStops.filter((s) => s.city !== cityStop.city)
                            : [...initialFuelStops, cityStop]
                        );
                        setOpenGasCity(null);
                      }}
                      className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-600"
                    >
                      {isSelected ? "Remove fuel stop" : "Add fuel stop here"}
                    </button>
                  </div>
                </InfoWindow>
              );
            })()}
        </Map>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p className="mb-2 text-sm font-medium text-slate-700">Gas</p>
        {dayGallons != null && tankPercent != null && (
          <p className="text-slate-600">
            {dayGallons.toFixed(1)} gal for this day ({tankPercent.toFixed(0)}% of tank)
          </p>
        )}
        {gasInfo?.average != null && (
          <p className="text-slate-600">
            Avg price along this leg: ${gasInfo.average.toFixed(2)}/gal
          </p>
        )}
        {gasInfo?.cheapest && (
          <p className="text-slate-600">
            Cheapest gas: {gasInfo.cheapest.city} ($
            {gasInfo.cheapest.avgPricePerGallon.toFixed(2)}/gal avg), arriving around{" "}
            {formatSecondsAsClockTime(gasInfo.cheapest.secondsSinceMidnight)}
          </p>
        )}

        <div className="mt-3">
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
            <div className="mt-2 text-xs text-slate-600">
              <p>
                {maxDrivingFraction !== null && maxDrivingFraction <= 0
                  ? `You're already within your ${FUEL_RESERVE_MILES}-mile reserve — refuel before continuing.`
                  : reachableGas === undefined
                    ? "Checking for gas within your range…"
                    : reachableGas
                      ? `Cheapest gas within range: ${reachableGas.city} ($${reachableGas.avgPricePerGallon.toFixed(2)}/gal avg), arriving around ${formatSecondsAsClockTime(reachableGas.secondsSinceMidnight)}`
                      : `No gas stations found before you'd hit your ${FUEL_RESERVE_MILES}-mile reserve.`}
              </p>
              {arrivalFuelInfo && (
                <>
                  <p>
                    Fuel left on arrival: ~{arrivalFuelInfo.gallonsRemaining.toFixed(1)} gal (
                    {arrivalFuelInfo.tankPercent.toFixed(0)}% of tank, ~
                    {Math.round(arrivalFuelInfo.rangeMiles)} mi range)
                  </p>
                  <p>
                    Cost to fill up there: ~${arrivalFuelInfo.fillUpCost.toFixed(2)}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div>
          {(() => {
            const rows = itinerary
              .filter((stop) => stop.label !== "Lunch" || initialLunchChoice)
              .map((stop) => {
                let detail: string | null = null;
                let fuelStop: FuelStopSelection | null = null;
                if (stop.label === "Departure") detail = boundaryCities?.start ?? null;
                else if (stop.label === "Arrival") detail = boundaryCities?.end ?? null;
                else if (stop.label === "Lunch")
                  detail = initialLunchChoice
                    ? `${initialLunchChoice.name} (${initialLunchChoice.type})${initialLunchChoice.city ? ` — ${initialLunchChoice.city}` : ""}`
                    : null;
                else if (stop.label === "Dinner") detail = dinnerCity;
                else if (stop.label === "Fuel" && stop.fuelStopIndex !== undefined) {
                  fuelStop = initialFuelStops[stop.fuelStopIndex] ?? null;
                  detail = fuelStop
                    ? `${fuelStop.city} ($${fuelStop.avgPricePerGallon.toFixed(2)}/gal avg)`
                    : null;
                }
                return {
                  label: stop.label === "Fuel" ? "Fuel stop" : (stop.label as string),
                  detail,
                  secondsSinceMidnight: stop.secondsSinceMidnight,
                  drivingFraction: stop.drivingFraction,
                  fuelStop,
                };
              });

            rows.sort((a, b) => a.secondsSinceMidnight - b.secondsSinceMidnight);

            const elements: ReactNode[] = [];
            rows.forEach((row, i) => {
              if (i > 0) {
                const prev = rows[i - 1];
                const legMeters = (row.drivingFraction - prev.drivingFraction) * day.distanceMeters;
                const legSeconds =
                  (row.drivingFraction - prev.drivingFraction) * day.durationSeconds;
                elements.push(
                  <div
                    key={`leg-${i}`}
                    className="grid grid-cols-[24px_1fr] items-center gap-2 py-1 text-xs text-slate-400"
                  >
                    <span className="text-center">↓</span>
                    <span>
                      {formatMiles(legMeters)} · {formatDuration(legSeconds)}
                    </span>
                  </div>
                );
              }
              elements.push(
                <div
                  key={i}
                  className="grid grid-cols-[24px_1fr_auto_24px] items-center gap-2 py-0.5 text-slate-600"
                >
                  <span className="text-center text-base" aria-hidden>
                    {stopIcon(row.label)}
                  </span>
                  <span>
                    {row.label}
                    {row.detail ? ` — ${row.detail}` : ""}
                  </span>
                  <span className="text-slate-500">
                    {formatSecondsAsClockTime(row.secondsSinceMidnight)}
                  </span>
                  {row.fuelStop && (
                    <button
                      type="button"
                      onClick={() =>
                        onFuelStopsChange(
                          initialFuelStops.filter((s) => s.city !== row.fuelStop!.city)
                        )
                      }
                      aria-label={`Remove fuel stop at ${row.fuelStop.city}`}
                      className="text-center text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );

              const plan = row.fuelStop ? fuelStopPlan?.[row.fuelStop.city] : undefined;
              if (plan?.unreachable) {
                elements.push(
                  <div key={`${i}-plan`} className="py-0.5 pl-8 text-xs text-red-500">
                    <p>
                      Not reachable with your current fuel range — move this fuel stop earlier.
                    </p>
                  </div>
                );
              } else if (plan) {
                elements.push(
                  <div key={`${i}-plan`} className="space-y-1 py-0.5 pl-8 text-xs text-slate-400">
                    <p>
                      ~{plan.gallonsRemaining.toFixed(1)} gal on arrival (
                      {plan.tankPercent.toFixed(0)}% of tank, ~
                      {Math.round(plan.arrivalRangeMiles)} mi range)
                    </p>
                    {plan.cheaperAhead ? (
                      <>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`fill-strategy-${row.fuelStop!.city}`}
                            checked={plan.chosenStrategy === "full"}
                            onChange={() =>
                              handleFillStrategyChange(row.fuelStop!.city, "full")
                            }
                          />
                          Fill up completely here: ~${plan.fillUpCost.toFixed(2)}
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`fill-strategy-${row.fuelStop!.city}`}
                            checked={plan.chosenStrategy === "partial"}
                            onChange={() =>
                              handleFillStrategyChange(row.fuelStop!.city, "partial")
                            }
                          />
                          Next stop is cheaper — buy ~
                          {plan.gallonsToBuyForNextCheaper!.toFixed(1)} gal here to reach it
                          with reserve instead of filling up
                        </label>
                      </>
                    ) : (
                      <p>Fill up completely here: ~${plan.fillUpCost.toFixed(2)}</p>
                    )}
                  </div>
                );
              }
            });

            return elements;
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

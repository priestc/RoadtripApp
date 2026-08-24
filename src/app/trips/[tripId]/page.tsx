"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import { isLunchSelection, sanitizeFuelStops } from "@/lib/routeDays";
import type { Trip, Vehicle } from "@/lib/types";
import RouteMap from "./RouteMap";

export default function TripDetailPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const { user, authLoading, profile } = useAuth();

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [vehicles, setVehicles] = useState<Array<Vehicle & { id: string }>>([]);
  const [vehicleIdOverride, setVehicleIdOverride] = useState<string | null>(
    null
  );
  const [fuelRangeOverride, setFuelRangeOverride] = useState<string | null>(
    null
  );

  // Memoized so these identities only change when the underlying Firestore
  // data actually does -- sanitizeFuelStops/.map() otherwise return a new
  // array on every render, which busts RouteMap's internal memoization and
  // re-runs its geocoding effect unnecessarily.
  const lunchChoicesByDay = useMemo(
    () => trip?.lunchChoicesByDay?.map((choice) => (isLunchSelection(choice) ? choice : null)),
    [trip]
  );
  const fuelStopsByDay = useMemo(
    () => trip?.fuelStopsByDay?.map(sanitizeFuelStops),
    [trip]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user || !params.tripId) return;
    const unsubscribe = onSnapshot(
      doc(getFirebaseDb(), "trips", params.tripId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setTrip(null);
          return;
        }
        const data = snapshot.data() as Trip;
        setTrip(data.userId === user.uid ? data : null);
      }
    );
    return unsubscribe;
  }, [user, params.tripId]);

  useEffect(() => {
    if (!user) return;
    const vehiclesQuery = query(
      collection(getFirebaseDb(), "users", user.uid, "vehicles"),
      orderBy("createdAt", "asc")
    );
    const unsubscribe = onSnapshot(vehiclesQuery, (snapshot) => {
      setVehicles(
        snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Vehicle) }))
      );
    });
    return unsubscribe;
  }, [user]);

  if (authLoading || !user || trip === undefined) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  if (trip === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Trip not found.</p>
      </main>
    );
  }

  function handleNumDaysChange(numDrivingDays: number) {
    if (!params.tripId) return;
    updateDoc(doc(getFirebaseDb(), "trips", params.tripId), {
      numDrivingDays,
    }).catch(() => {
      // Non-critical — the map already reflects the new selection locally.
    });
  }

  function handleVehicleChange(vehicleId: string) {
    setVehicleIdOverride(vehicleId);
    if (!params.tripId) return;
    updateDoc(doc(getFirebaseDb(), "trips", params.tripId), {
      vehicleId,
    }).catch(() => {
      // Non-critical — the selection already reflects locally.
    });
  }

  function handleFuelRangeBlur() {
    if (!params.tripId) return;
    const parsed = Number(fuelRangeInput);
    updateDoc(doc(getFirebaseDb(), "trips", params.tripId), {
      currentFuelRangeMiles:
        fuelRangeInput.trim() !== "" && !Number.isNaN(parsed) && parsed > 0
          ? parsed
          : null,
    }).catch(() => {
      // Non-critical — the map already reflects the current value locally.
    });
  }

  const vehicleId = vehicleIdOverride ?? trip.vehicleId ?? "";
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const fuelRangeInput =
    fuelRangeOverride ??
    (trip.currentFuelRangeMiles != null
      ? String(trip.currentFuelRangeMiles)
      : "");
  const parsedFuelRange = Number(fuelRangeInput);
  const fuelRangeMiles =
    fuelRangeInput.trim() !== "" && !Number.isNaN(parsedFuelRange) && parsedFuelRange > 0
      ? parsedFuelRange
      : null;

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {describeDeparture(trip.departureLocation, profile?.homeAddress)} →{" "}
            {trip.destination}
          </h1>
          <p className="mt-1 text-slate-500">{describeDeadline(trip)}</p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="space-y-1">
            <label
              htmlFor="vehicle"
              className="block text-sm font-medium text-slate-700"
            >
              Vehicle
            </label>
            <select
              id="vehicle"
              value={vehicleId}
              onChange={(e) => handleVehicleChange(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">
                {vehicles.length === 0 ? "No saved vehicles" : "Select a vehicle"}
              </option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
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
              placeholder="e.g. 300"
              value={fuelRangeInput}
              onChange={(e) => setFuelRangeOverride(e.target.value)}
              onBlur={handleFuelRangeBlur}
              className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <RouteMap
          tripId={params.tripId}
          departureLocation={trip.departureLocation}
          destination={trip.destination}
          initialNumDays={trip.numDrivingDays}
          onNumDaysChange={handleNumDaysChange}
          fuelRangeMiles={fuelRangeMiles}
          initialLunchChoices={lunchChoicesByDay}
          initialFuelStopsByDay={fuelStopsByDay}
          vehicle={
            selectedVehicle
              ? {
                  gasMileageMpg: selectedVehicle.gasMileageMpg,
                  fuelCapacityGallons: selectedVehicle.fuelCapacityGallons,
                }
              : null
          }
        />
      </div>
    </main>
  );
}

function describeDeparture(
  departureLocation: string,
  homeAddress: string | undefined
): string {
  if (homeAddress && departureLocation.trim() === homeAddress.trim()) {
    return "Home";
  }
  return departureLocation;
}

function describeDeadline(trip: Trip): string {
  if (trip.deadlineType === "tbd" || !trip.deadlineDateTime) {
    return "No dates set yet";
  }
  const formatted = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  if (trip.deadlineType === "hard") {
    return `Must arrive by ${formatted(trip.deadlineDateTime)}`;
  }
  const departure = `Planning to leave around ${formatted(trip.deadlineDateTime)}`;
  return trip.plannedArrivalDateTime
    ? `${departure}, arriving around ${formatted(trip.plannedArrivalDateTime)}`
    : departure;
}

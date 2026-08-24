"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import {
  isLunchSelection,
  sanitizeFuelStops,
  type FuelStopSelection,
  type LunchSelection,
} from "@/lib/routeDays";
import type { Trip, Vehicle } from "@/lib/types";
import DayMap from "./DayMap";

export default function DayDetailPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string; dayIndex: string }>();
  const { user, authLoading, profile } = useAuth();

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [vehicles, setVehicles] = useState<Array<Vehicle & { id: string }>>([]);
  const [boundaryCities, setBoundaryCities] = useState<{
    start: string | null;
    end: string | null;
  } | null>(null);
  const [totalDays, setTotalDays] = useState<number | null>(null);

  const dayIndex = Number(params.dayIndex);

  // Memoized so this array's identity only changes when the underlying
  // Firestore data actually does -- sanitizeFuelStops always returns a new
  // array, and an unmemoized value here was recreated on every render
  // (including ones triggered by DayMap's own onBoundaryCitiesChange /
  // onNumDaysChange callbacks), which busted DayMap's itinerary memo and
  // re-ran its geocoding effect in a tight loop on every render.
  const initialFuelStops = useMemo(
    () => sanitizeFuelStops(trip?.fuelStopsByDay?.[dayIndex]),
    [trip, dayIndex]
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

  if (trip === null || Number.isNaN(dayIndex) || dayIndex < 0) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Day not found.</p>
      </main>
    );
  }

  function handleLunchChoiceChange(choice: LunchSelection | null) {
    if (!params.tripId || !trip) return;
    const updated = [...(trip.lunchChoicesByDay ?? [])];
    while (updated.length <= dayIndex) updated.push(null);
    updated[dayIndex] = choice;
    updateDoc(doc(getFirebaseDb(), "trips", params.tripId), {
      lunchChoicesByDay: updated,
    }).catch(() => {
      // Non-critical — the picker already reflects the selection locally.
    });
  }

  function handleFuelStopsChange(stops: FuelStopSelection[]) {
    if (!params.tripId || !trip) return;
    // Each day's stops must be wrapped in an object -- Firestore rejects an
    // array nested directly inside another array.
    const updated = [...(trip.fuelStopsByDay ?? [])];
    while (updated.length <= dayIndex) updated.push({ stops: [] });
    updated[dayIndex] = { stops };
    updateDoc(doc(getFirebaseDb(), "trips", params.tripId), {
      fuelStopsByDay: updated,
    }).catch(() => {
      // Non-critical — the map already reflects the selection locally.
    });
  }

  const rawChoice = trip.lunchChoicesByDay?.[dayIndex];
  const initialLunchChoice = isLunchSelection(rawChoice) ? rawChoice : null;

  const vehicleId = trip.vehicleId ?? "";
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <Link
            href={`/trips/${params.tripId}`}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to trip
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Day {dayIndex + 1}
          </h1>
          <p className="mt-1 text-slate-500">
            {dayIndex === 0
              ? describeDeparture(trip.departureLocation, profile?.homeAddress)
              : (boundaryCities?.start ?? "…")}{" "}
            → {boundaryCities?.end ?? "…"}
          </p>
        </div>

        <DayMap
          dayIndex={dayIndex}
          departureLocation={trip.departureLocation}
          destination={trip.destination}
          initialNumDays={trip.numDrivingDays}
          initialLunchChoice={initialLunchChoice}
          onLunchChoiceChange={handleLunchChoiceChange}
          initialFuelStops={initialFuelStops}
          onFuelStopsChange={handleFuelStopsChange}
          onBoundaryCitiesChange={setBoundaryCities}
          onNumDaysChange={setTotalDays}
          vehicle={
            selectedVehicle
              ? {
                  gasMileageMpg: selectedVehicle.gasMileageMpg,
                  fuelCapacityGallons: selectedVehicle.fuelCapacityGallons,
                }
              : null
          }
        />

        {totalDays !== null && dayIndex + 1 < totalDays && (
          <div className="text-right">
            <Link
              href={`/trips/${params.tripId}/days/${dayIndex + 1}`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Day {dayIndex + 2} itinerary →
            </Link>
          </div>
        )}
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

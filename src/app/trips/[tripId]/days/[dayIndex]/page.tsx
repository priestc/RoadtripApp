"use client";

import { useEffect, useState } from "react";
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
import { isLunchSelection, type LunchSelection } from "@/lib/routeDays";
import type { Trip, Vehicle } from "@/lib/types";
import DayMap from "./DayMap";

export default function DayDetailPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string; dayIndex: string }>();
  const { user, authLoading, profile } = useAuth();

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [vehicles, setVehicles] = useState<Array<Vehicle & { id: string }>>([]);

  const dayIndex = Number(params.dayIndex);

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
            {describeDeparture(trip.departureLocation, profile?.homeAddress)} →{" "}
            {trip.destination}
          </p>
        </div>

        <DayMap
          dayIndex={dayIndex}
          departureLocation={trip.departureLocation}
          destination={trip.destination}
          initialNumDays={trip.numDrivingDays}
          initialLunchChoice={initialLunchChoice}
          onLunchChoiceChange={handleLunchChoiceChange}
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

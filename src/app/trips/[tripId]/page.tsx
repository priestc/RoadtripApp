"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { Trip } from "@/lib/types";
import RouteMap from "./RouteMap";

export default function TripDetailPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const { user, authLoading, profile } = useAuth();

  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);

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

        <RouteMap
          departureLocation={trip.departureLocation}
          destination={trip.destination}
          initialNumDays={trip.numDrivingDays}
          onNumDaysChange={handleNumDaysChange}
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { Trip } from "@/lib/types";
import FuelOverviewMap from "./FuelOverviewMap";

export default function FuelOverviewPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const { user, authLoading } = useAuth();

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
            Fuel overview
          </h1>
          <p className="mt-1 text-slate-500">
            Every gas price found along the whole route, cheapest in green,
            priciest in red.
          </p>
        </div>

        <FuelOverviewMap
          departureLocation={trip.departureLocation}
          destination={trip.destination}
          initialNumDays={trip.numDrivingDays}
        />
      </div>
    </main>
  );
}

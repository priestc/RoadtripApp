"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { Trip } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();
  const [trips, setTrips] = useState<Array<Trip & { id: string }>>([]);
  const [tripsLoading, setTripsLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (!profileLoading && !profile?.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [authLoading, user, profile, profileLoading, router]);

  useEffect(() => {
    if (!user) return;
    const tripsQuery = query(
      collection(getFirebaseDb(), "trips"),
      where("userId", "==", user.uid)
    );
    const unsubscribe = onSnapshot(tripsQuery, (snapshot) => {
      const results = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as Trip) }))
        .sort((a, b) => {
          const aMillis = toMillis(a.createdAt);
          const bMillis = toMillis(b.createdAt);
          return bMillis - aMillis;
        });
      setTrips(results);
      setTripsLoading(false);
    });
    return unsubscribe;
  }, [user]);

  if (authLoading || !user || profileLoading || !profile?.onboardingComplete) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            You&apos;re all set, {user.displayName?.split(" ")[0] ?? "there"}.
          </h1>
          <p className="mt-1 text-slate-500">
            Trip planning isn&apos;t built yet — for now, here&apos;s what
            you told us.
          </p>
        </div>

        <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          <Row label="Earliest departure" value={profile.earliestDepartureTime} />
          <Row label="Breakfast" value={profile.breakfastTime ?? "Skipped"} />
          <Row label="Lunch" value={profile.lunchTime} />
          <Row label="Dinner" value={profile.dinnerTime} />
        </dl>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Your trips
            </h2>
            <Link
              href="/trips/new"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              Add new trip
            </Link>
          </div>

          {tripsLoading ? (
            <p className="text-sm text-slate-500">Loading trips…</p>
          ) : trips.length === 0 ? (
            <p className="text-sm text-slate-500">
              No trips yet — create your first one above.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {trips.map((trip) => (
                <li key={trip.id}>
                  <Link
                    href={`/trips/${trip.id}`}
                    className="block px-4 py-3 transition hover:bg-slate-50"
                  >
                    <p className="font-medium text-slate-900">
                      {trip.departureLocation} → {trip.destination}
                    </p>
                    <p className="text-sm text-slate-500">
                      {trip.deadlineType === "tbd"
                        ? "No dates set yet"
                        : trip.deadlineType === "hard"
                          ? "Hard deadline"
                          : "Soft target"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={() => signOut(getFirebaseAuth())}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function toMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

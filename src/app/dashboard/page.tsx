"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";

export default function DashboardPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();

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
          <Row label="Max driving hours/day" value={String(profile.maxDrivingHoursPerDay)} />
          <Row
            label="Departure window"
            value={`${profile.earliestDepartureTime} – ${profile.latestDepartureTime}`}
          />
          <Row
            label="Stopping window"
            value={`${profile.earliestStoppingTime} – ${profile.latestStoppingTime}`}
          />
          <Row label="Breakfast" value={profile.breakfastTime ?? "Skipped"} />
          <Row label="Lunch" value={profile.lunchTime} />
          <Row label="Dinner" value={profile.dinnerTime} />
        </dl>

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

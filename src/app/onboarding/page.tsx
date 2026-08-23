"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { DrivingPreferences } from "@/lib/types";

const DEFAULTS = {
  maxDrivingHoursPerDay: "8",
  earliestDepartureTime: "07:00",
  latestDepartureTime: "11:00",
  earliestStoppingTime: "15:00",
  latestStoppingTime: "20:00",
  breakfastTime: "08:00",
  lunchTime: "12:30",
  dinnerTime: "18:30",
};

export default function OnboardingPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();

  const [maxDrivingHoursPerDay, setMaxDrivingHoursPerDay] = useState(
    DEFAULTS.maxDrivingHoursPerDay
  );
  const [earliestDepartureTime, setEarliestDepartureTime] = useState(
    DEFAULTS.earliestDepartureTime
  );
  const [latestDepartureTime, setLatestDepartureTime] = useState(
    DEFAULTS.latestDepartureTime
  );
  const [earliestStoppingTime, setEarliestStoppingTime] = useState(
    DEFAULTS.earliestStoppingTime
  );
  const [latestStoppingTime, setLatestStoppingTime] = useState(
    DEFAULTS.latestStoppingTime
  );
  const [skipBreakfast, setSkipBreakfast] = useState(false);
  const [breakfastTime, setBreakfastTime] = useState(DEFAULTS.breakfastTime);
  const [lunchTime, setLunchTime] = useState(DEFAULTS.lunchTime);
  const [dinnerTime, setDinnerTime] = useState(DEFAULTS.dinnerTime);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (!profileLoading && profile?.onboardingComplete) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, profile, profileLoading, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSaving(true);
    try {
      const preferences: DrivingPreferences = {
        maxDrivingHoursPerDay: Number(maxDrivingHoursPerDay),
        earliestDepartureTime,
        latestDepartureTime,
        earliestStoppingTime,
        latestStoppingTime,
        breakfastTime: skipBreakfast ? null : breakfastTime,
        lunchTime,
        dinnerTime,
        onboardingComplete: true,
      };
      await setDoc(doc(getFirebaseDb(), "users", user.uid), preferences);
      router.replace("/dashboard");
    } catch {
      setError("Couldn't save your preferences. Please try again.");
      setSaving(false);
    }
  }

  if (authLoading || !user || profileLoading || profile?.onboardingComplete) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Let&apos;s set up your driving preferences
          </h1>
          <p className="mt-1 text-slate-500">
            This helps RoadtripApp plan stops and days that fit how you
            actually like to drive. You can change these any time.
          </p>
        </div>

        <Field label="How many hours per day are you comfortable driving?">
          <input
            type="number"
            min={1}
            max={24}
            step={0.5}
            required
            value={maxDrivingHoursPerDay}
            onChange={(e) => setMaxDrivingHoursPerDay(e.target.value)}
            className={inputClass}
          />
        </Field>

        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-700">
            Departure window
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Earliest you want to leave">
              <input
                type="time"
                required
                value={earliestDepartureTime}
                onChange={(e) => setEarliestDepartureTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Latest you're comfortable leaving">
              <input
                type="time"
                required
                value={latestDepartureTime}
                onChange={(e) => setLatestDepartureTime(e.target.value)}
                className={inputClass}
              />
              <Hint>Defaults to 11:00 AM, typical hotel checkout time.</Hint>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-700">
            Stopping window for the night
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Earliest you're comfortable stopping">
              <input
                type="time"
                required
                value={earliestStoppingTime}
                onChange={(e) => setEarliestStoppingTime(e.target.value)}
                className={inputClass}
              />
              <Hint>Defaults to 3:00 PM, typical hotel check-in time.</Hint>
            </Field>
            <Field label="Latest you're comfortable stopping">
              <input
                type="time"
                required
                value={latestStoppingTime}
                onChange={(e) => setLatestStoppingTime(e.target.value)}
                className={inputClass}
              />
              <Hint>Defaults to sunset once the app can calculate it locally.</Hint>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-slate-700">
            Typical mealtimes
          </legend>

          <Field label="Breakfast">
            <div className="flex items-center gap-3">
              <input
                type="time"
                disabled={skipBreakfast}
                value={breakfastTime}
                onChange={(e) => setBreakfastTime(e.target.value)}
                className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
              />
              <label className="flex items-center gap-2 text-sm text-slate-500">
                <input
                  type="checkbox"
                  checked={skipBreakfast}
                  onChange={(e) => setSkipBreakfast(e.target.checked)}
                />
                I don&apos;t usually eat breakfast
              </label>
            </div>
          </Field>

          <Field label="Lunch">
            <input
              type="time"
              required
              value={lunchTime}
              onChange={(e) => setLunchTime(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Dinner">
            <input
              type="time"
              required
              value={dinnerTime}
              onChange={(e) => setDinnerTime(e.target.value)}
              className={inputClass}
            />
          </Field>
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </main>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}

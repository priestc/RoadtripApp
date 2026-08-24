"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { DeadlineType, Trip } from "@/lib/types";

export default function NewTripPage() {
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

  // profile is guaranteed loaded here, so the form below can safely seed its
  // initial state from profile.homeAddress without needing an effect.
  return <NewTripForm userId={user.uid} homeAddress={profile.homeAddress} />;
}

function NewTripForm({
  userId,
  homeAddress,
}: {
  userId: string;
  homeAddress: string | undefined;
}) {
  const router = useRouter();

  const [destination, setDestination] = useState("");
  const [departureLocation, setDepartureLocation] = useState(homeAddress ?? "");
  const [saveAsHome, setSaveAsHome] = useState(true);
  const [deadlineType, setDeadlineType] = useState<DeadlineType>("tbd");
  const [deadlineDateTime, setDeadlineDateTime] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const trip: Trip = {
        userId,
        destination: destination.trim(),
        departureLocation: departureLocation.trim(),
        deadlineType,
        deadlineDateTime:
          deadlineType === "tbd"
            ? null
            : new Date(deadlineDateTime).toISOString(),
        createdAt: serverTimestamp(),
      };
      const tripRef = await addDoc(collection(getFirebaseDb(), "trips"), trip);

      if (saveAsHome && departureLocation.trim() !== (homeAddress ?? "")) {
        await setDoc(
          doc(getFirebaseDb(), "users", userId),
          { homeAddress: departureLocation.trim() },
          { merge: true }
        );
      }

      router.push(`/trips/${tripRef.id}`);
    } catch {
      setError("Couldn't create this trip. Please try again.");
      setSaving(false);
    }
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Plan a new trip
          </h1>
          <p className="mt-1 text-slate-500">
            Just the basics for now — fuel and food stops come later.
          </p>
        </div>

        <Field label="Destination">
          <input
            type="text"
            required
            placeholder="e.g. Yellowstone National Park"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="space-y-1">
          <Field label="Departure location">
            <input
              type="text"
              required
              placeholder="e.g. 123 Main St, Columbus, OH"
              value={departureLocation}
              onChange={(e) => setDepartureLocation(e.target.value)}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={saveAsHome}
              onChange={(e) => setSaveAsHome(e.target.checked)}
            />
            Save as my home address
          </label>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-slate-700">
            Timing
          </legend>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-slate-500 has-[:checked]:bg-slate-50">
            <input
              type="radio"
              name="deadlineType"
              className="mt-1"
              checked={deadlineType === "hard"}
              onChange={() => setDeadlineType("hard")}
            />
            <span>
              <span className="block font-medium text-slate-900">
                Hard arrival deadline
              </span>
              <span className="block text-sm text-slate-500">
                I have to be there by a specific time (flight, event, etc.)
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-slate-500 has-[:checked]:bg-slate-50">
            <input
              type="radio"
              name="deadlineType"
              className="mt-1"
              checked={deadlineType === "soft"}
              onChange={() => setDeadlineType("soft")}
            />
            <span>
              <span className="block font-medium text-slate-900">
                Departure date/time (soft target)
              </span>
              <span className="block text-sm text-slate-500">
                I have a rough plan, but nothing that can&apos;t move
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-slate-500 has-[:checked]:bg-slate-50">
            <input
              type="radio"
              name="deadlineType"
              className="mt-1"
              checked={deadlineType === "tbd"}
              onChange={() => setDeadlineType("tbd")}
            />
            <span>
              <span className="block font-medium text-slate-900">
                No dates yet
              </span>
              <span className="block text-sm text-slate-500">
                I&apos;ll decide when to leave later
              </span>
            </span>
          </label>

          {deadlineType !== "tbd" && (
            <Field
              label={
                deadlineType === "hard"
                  ? "Must arrive by"
                  : "Planning to leave around"
              }
            >
              <input
                type="datetime-local"
                required
                value={deadlineDateTime}
                onChange={(e) => setDeadlineDateTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create trip"}
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

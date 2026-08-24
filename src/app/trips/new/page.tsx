"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import { Field, inputClass } from "@/components/FormControls";
import AddressAutocomplete from "@/components/AddressAutocomplete";
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
  const [departureLocation, setDepartureLocation] = useState("");
  const [deadlineType, setDeadlineType] = useState<DeadlineType>("tbd");
  const [deadlineDateTime, setDeadlineDateTime] = useState("");
  const [plannedArrivalDateTime, setPlannedArrivalDateTime] = useState("");

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
        plannedArrivalDateTime:
          deadlineType === "soft"
            ? new Date(plannedArrivalDateTime).toISOString()
            : null,
        createdAt: serverTimestamp(),
      };
      const tripRef = await addDoc(collection(getFirebaseDb(), "trips"), trip);
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
          <AddressAutocomplete
            value={destination}
            onChange={setDestination}
            placeholder="e.g. Yellowstone National Park"
          />
        </Field>

        <div className="space-y-1">
          <Field label="Departure location">
            <AddressAutocomplete
              value={departureLocation}
              onChange={setDepartureLocation}
              placeholder="e.g. 123 Main St, Columbus, OH"
            />
          </Field>
          {homeAddress && (
            <button
              type="button"
              onClick={() => setDepartureLocation(homeAddress)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Use home address
            </button>
          )}
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

          {deadlineType === "soft" && (
            <Field label="Planned to arrive around">
              <input
                type="datetime-local"
                required
                value={plannedArrivalDateTime}
                onChange={(e) => setPlannedArrivalDateTime(e.target.value)}
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

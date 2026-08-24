"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import {
  PreferencesForm,
  type PreferencesFormValues,
  Field,
  inputClass,
} from "@/components/PreferencesForm";
import type { Vehicle } from "@/lib/types";

export default function PreferencesPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  const [vehicles, setVehicles] = useState<Array<Vehicle & { id: string }>>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

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
      setVehiclesLoading(false);
    });
    return unsubscribe;
  }, [user]);

  async function handleSavePreferences(values: PreferencesFormValues) {
    if (!user) return;
    await setDoc(doc(getFirebaseDb(), "users", user.uid), values, {
      merge: true,
    });
  }

  if (authLoading || !user || profileLoading || !profile) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-12">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Preferences
          </h1>
          <p className="mt-1 text-slate-500">
            Update your driving preferences and manage your vehicles.
          </p>
        </div>

        <PreferencesForm
          initialValues={profile}
          onSubmit={handleSavePreferences}
          submitLabel="Save preferences"
        />

        <VehiclesSection
          userId={user.uid}
          vehicles={vehicles}
          vehiclesLoading={vehiclesLoading}
        />
      </div>
    </main>
  );
}

function VehiclesSection({
  userId,
  vehicles,
  vehiclesLoading,
}: {
  userId: string;
  vehicles: Array<Vehicle & { id: string }>;
  vehiclesLoading: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Your vehicles
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            Add vehicle
          </button>
        )}
      </div>

      {adding && (
        <VehicleForm userId={userId} onDone={() => setAdding(false)} />
      )}

      {vehiclesLoading ? (
        <p className="text-sm text-slate-500">Loading vehicles…</p>
      ) : vehicles.length === 0 && !adding ? (
        <p className="text-sm text-slate-500">
          No vehicles yet — add one above.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {vehicles.map((vehicle) =>
            editingId === vehicle.id ? (
              <li key={vehicle.id} className="px-4 py-4">
                <VehicleForm
                  userId={userId}
                  vehicleId={vehicle.id}
                  initialValues={vehicle}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={vehicle.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{vehicle.name}</p>
                  <p className="text-sm text-slate-500">
                    {vehicle.fuelCapacityGallons} gal tank ·{" "}
                    {vehicle.gasMileageMpg} mpg
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditingId(vehicle.id)}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      deleteDoc(
                        doc(
                          getFirebaseDb(),
                          "users",
                          userId,
                          "vehicles",
                          vehicle.id
                        )
                      )
                    }
                    className="text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function VehicleForm({
  userId,
  vehicleId,
  initialValues,
  onDone,
}: {
  userId: string;
  vehicleId?: string;
  initialValues?: Vehicle;
  onDone: () => void;
}) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [fuelCapacityGallons, setFuelCapacityGallons] = useState(
    initialValues ? String(initialValues.fuelCapacityGallons) : ""
  );
  const [gasMileageMpg, setGasMileageMpg] = useState(
    initialValues ? String(initialValues.gasMileageMpg) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const data = {
        name,
        fuelCapacityGallons: Number(fuelCapacityGallons),
        gasMileageMpg: Number(gasMileageMpg),
      };
      if (vehicleId) {
        await updateDoc(
          doc(getFirebaseDb(), "users", userId, "vehicles", vehicleId),
          data
        );
      } else {
        await addDoc(collection(getFirebaseDb(), "users", userId, "vehicles"), {
          ...data,
          createdAt: serverTimestamp(),
        });
      }
      onDone();
    } catch {
      setError("Couldn't save this vehicle. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <Field label="Name">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Honda Civic"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Fuel capacity (gallons)">
          <input
            type="number"
            min={0}
            step={0.1}
            required
            value={fuelCapacityGallons}
            onChange={(e) => setFuelCapacityGallons(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Gas mileage (mpg)">
          <input
            type="number"
            min={0}
            step={0.1}
            required
            value={gasMileageMpg}
            onChange={(e) => setGasMileageMpg(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save vehicle"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

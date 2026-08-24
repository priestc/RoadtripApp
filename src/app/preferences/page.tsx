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
  updateDoc,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import { Field, Hint, inputClass } from "@/components/FormControls";
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
          <p className="mt-1 text-slate-500">Manage your vehicles.</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-700">Meal stops are automatic</p>
          <p className="mt-1">
            Breakfast happens before you start driving each day. A lunch stop
            is added for any driving leg over 4 hours, and a dinner stop is
            added on top of that for legs over 8 hours — no need to set meal
            times.
          </p>
        </div>

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

interface LookupOption {
  label: string;
  value: string;
}

async function fetchLookup(url: string): Promise<LookupOption[] | null> {
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
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
  const isEditing = Boolean(vehicleId);

  const [name, setName] = useState(initialValues?.name ?? "");
  const [fuelCapacityGallons, setFuelCapacityGallons] = useState(
    initialValues ? String(initialValues.fuelCapacityGallons) : ""
  );
  const [gasMileageMpg, setGasMileageMpg] = useState(
    initialValues ? String(initialValues.gasMileageMpg) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"lookup" | "manual">(
    isEditing ? "manual" : "lookup"
  );

  const [years, setYears] = useState<LookupOption[]>([]);
  const [yearsLoading, setYearsLoading] = useState(!isEditing);
  const [yearsError, setYearsError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState("");

  const [makes, setMakes] = useState<LookupOption[]>([]);
  const [makesLoading, setMakesLoading] = useState(false);
  const [makesError, setMakesError] = useState<string | null>(null);
  const [selectedMake, setSelectedMake] = useState("");

  const [models, setModels] = useState<LookupOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");

  const [trims, setTrims] = useState<LookupOption[]>([]);
  const [trimsLoading, setTrimsLoading] = useState(false);
  const [trimsError, setTrimsError] = useState<string | null>(null);
  const [selectedTrim, setSelectedTrim] = useState("");

  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Data fetches live in effects (setState only inside the async callback,
  // never synchronously in the effect body). Resetting downstream
  // selections/lists and flipping the "loading" flag on happens in the
  // onChange handlers below instead, since those run outside any effect.

  useEffect(() => {
    if (mode !== "lookup" || years.length > 0) return;
    let cancelled = false;
    fetchLookup("/api/fuel-economy/years").then((data) => {
      if (cancelled) return;
      if (data) setYears(data);
      else setYearsError("Couldn't load model years.");
      setYearsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, years.length]);

  useEffect(() => {
    if (!selectedYear) return;
    let cancelled = false;
    fetchLookup(
      `/api/fuel-economy/makes?year=${encodeURIComponent(selectedYear)}`
    ).then((data) => {
      if (cancelled) return;
      if (data) setMakes(data);
      else setMakesError("Couldn't load makes.");
      setMakesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  useEffect(() => {
    if (!selectedYear || !selectedMake) return;
    let cancelled = false;
    fetchLookup(
      `/api/fuel-economy/models?year=${encodeURIComponent(
        selectedYear
      )}&make=${encodeURIComponent(selectedMake)}`
    ).then((data) => {
      if (cancelled) return;
      if (data) setModels(data);
      else setModelsError("Couldn't load models.");
      setModelsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedYear, selectedMake]);

  useEffect(() => {
    if (!selectedYear || !selectedMake || !selectedModel) return;
    let cancelled = false;
    fetchLookup(
      `/api/fuel-economy/options?year=${encodeURIComponent(
        selectedYear
      )}&make=${encodeURIComponent(selectedMake)}&model=${encodeURIComponent(
        selectedModel
      )}`
    ).then((data) => {
      if (cancelled) return;
      if (data) {
        setTrims(data);
        if (data.length === 1) {
          setSelectedTrim(data[0].value);
          resolveVehicle(data[0].value, selectedMake, selectedModel);
        }
      } else {
        setTrimsError("Couldn't load vehicle configurations.");
      }
      setTrimsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedYear, selectedMake, selectedModel]);

  async function resolveVehicle(id: string, make: string, model: string) {
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(
        `/api/fuel-economy/vehicle?id=${encodeURIComponent(id)}`
      );
      const data = await res.json();
      if (typeof data.combinedMpg === "number") {
        setName(`${make} ${model}`);
        setGasMileageMpg(String(data.combinedMpg));
      } else {
        setResolveError("Couldn't load MPG for this vehicle.");
      }
    } catch {
      setResolveError("Couldn't load MPG for this vehicle.");
    } finally {
      setResolving(false);
    }
  }

  function handleYearChange(value: string) {
    setSelectedYear(value);
    setSelectedMake("");
    setMakes([]);
    setMakesError(null);
    setSelectedModel("");
    setModels([]);
    setModelsError(null);
    setSelectedTrim("");
    setTrims([]);
    setTrimsError(null);
    setResolveError(null);
    if (value) setMakesLoading(true);
  }

  function handleMakeChange(value: string) {
    setSelectedMake(value);
    setSelectedModel("");
    setModels([]);
    setModelsError(null);
    setSelectedTrim("");
    setTrims([]);
    setTrimsError(null);
    setResolveError(null);
    if (value) setModelsLoading(true);
  }

  function handleModelChange(value: string) {
    setSelectedModel(value);
    setSelectedTrim("");
    setTrims([]);
    setTrimsError(null);
    setResolveError(null);
    if (value) setTrimsLoading(true);
  }

  function handleTrimChange(value: string) {
    setSelectedTrim(value);
    setResolveError(null);
    if (value) resolveVehicle(value, selectedMake, selectedModel);
  }

  function handleModeToggle() {
    const nextMode = mode === "lookup" ? "manual" : "lookup";
    setMode(nextMode);
    if (nextMode === "lookup" && years.length === 0) setYearsLoading(true);
  }

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
      {!isEditing && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            {mode === "lookup" ? "Look up your car" : "Enter details manually"}
          </p>
          <button
            type="button"
            onClick={handleModeToggle}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            {mode === "lookup"
              ? "My car isn't listed / enter manually"
              : "Use car lookup instead"}
          </button>
        </div>
      )}

      {!isEditing && mode === "lookup" && (
        <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Year">
              <select
                required
                value={selectedYear}
                onChange={(e) => handleYearChange(e.target.value)}
                disabled={yearsLoading}
                className={inputClass}
              >
                <option value="">
                  {yearsLoading ? "Loading…" : "Select year"}
                </option>
                {years.map((y) => (
                  <option key={y.value} value={y.value}>
                    {y.label}
                  </option>
                ))}
              </select>
              {yearsError && <Hint>{yearsError}</Hint>}
            </Field>
            <Field label="Make">
              <select
                required
                value={selectedMake}
                onChange={(e) => handleMakeChange(e.target.value)}
                disabled={!selectedYear || makesLoading}
                className={inputClass}
              >
                <option value="">
                  {makesLoading ? "Loading…" : "Select make"}
                </option>
                {makes.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {makesError && <Hint>{makesError}</Hint>}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Model">
              <select
                required
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={!selectedMake || modelsLoading}
                className={inputClass}
              >
                <option value="">
                  {modelsLoading ? "Loading…" : "Select model"}
                </option>
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {modelsError && <Hint>{modelsError}</Hint>}
            </Field>

            {trims.length > 1 && (
              <Field label="Configuration">
                <select
                  required
                  value={selectedTrim}
                  onChange={(e) => handleTrimChange(e.target.value)}
                  disabled={trimsLoading}
                  className={inputClass}
                >
                  <option value="">
                    {trimsLoading ? "Loading…" : "Select configuration"}
                  </option>
                  {trims.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {trimsError && <Hint>{trimsError}</Hint>}
              </Field>
            )}
          </div>

          {resolving && (
            <p className="text-xs text-slate-400">Looking up MPG…</p>
          )}
          {resolveError && (
            <p className="text-xs text-red-600">{resolveError}</p>
          )}
        </div>
      )}

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

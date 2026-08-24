"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export interface PreferencesFormValues {
  maxDrivingHoursPerDay: number;
  earliestDepartureTime: string;
  latestDepartureTime: string;
  earliestStoppingTime: string;
  latestStoppingTime: string;
  breakfastTime: string | null;
  lunchTime: string;
  dinnerTime: string;
}

const DEFAULTS: PreferencesFormValues = {
  maxDrivingHoursPerDay: 8,
  earliestDepartureTime: "07:00",
  latestDepartureTime: "11:00",
  earliestStoppingTime: "15:00",
  latestStoppingTime: "20:00",
  breakfastTime: "08:00",
  lunchTime: "12:30",
  dinnerTime: "18:30",
};

interface PreferencesFormProps {
  initialValues?: Partial<PreferencesFormValues>;
  onSubmit: (values: PreferencesFormValues) => Promise<void>;
  submitLabel: string;
}

export function PreferencesForm({
  initialValues,
  onSubmit,
  submitLabel,
}: PreferencesFormProps) {
  const merged = { ...DEFAULTS, ...initialValues };

  const [maxDrivingHoursPerDay, setMaxDrivingHoursPerDay] = useState(
    String(merged.maxDrivingHoursPerDay)
  );
  const [earliestDepartureTime, setEarliestDepartureTime] = useState(
    merged.earliestDepartureTime
  );
  const [latestDepartureTime, setLatestDepartureTime] = useState(
    merged.latestDepartureTime
  );
  const [earliestStoppingTime, setEarliestStoppingTime] = useState(
    merged.earliestStoppingTime
  );
  const [latestStoppingTime, setLatestStoppingTime] = useState(
    merged.latestStoppingTime
  );
  const [skipBreakfast, setSkipBreakfast] = useState(
    merged.breakfastTime === null
  );
  const [breakfastTime, setBreakfastTime] = useState(
    merged.breakfastTime ?? DEFAULTS.breakfastTime!
  );
  const [lunchTime, setLunchTime] = useState(merged.lunchTime);
  const [dinnerTime, setDinnerTime] = useState(merged.dinnerTime);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        maxDrivingHoursPerDay: Number(maxDrivingHoursPerDay),
        earliestDepartureTime,
        latestDepartureTime,
        earliestStoppingTime,
        latestStoppingTime,
        breakfastTime: skipBreakfast ? null : breakfastTime,
        lunchTime,
        dinnerTime,
      });
    } catch {
      setError("Couldn't save your preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
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
        {saving ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}

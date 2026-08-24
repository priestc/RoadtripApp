"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export interface PreferencesFormValues {
  breakfastTime: string | null;
  lunchTime: string;
  dinnerTime: string;
}

const DEFAULTS: PreferencesFormValues = {
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

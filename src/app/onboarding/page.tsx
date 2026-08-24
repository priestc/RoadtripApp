"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import type { DrivingPreferences } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();
  const [saving, setSaving] = useState(false);

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

  async function handleContinue() {
    if (!user) return;
    setSaving(true);
    const preferences: DrivingPreferences = { onboardingComplete: true };
    await setDoc(doc(getFirebaseDb(), "users", user.uid), preferences);
    router.replace("/dashboard");
  }

  if (authLoading || !user || profileLoading || profile?.onboardingComplete) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-8 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to RoadtripApp
          </h1>
          <p className="mt-1 text-slate-500">
            Let&apos;s plan your first trip. You can add vehicles and a home
            address any time from Preferences.
          </p>
        </div>

        <button
          onClick={handleContinue}
          disabled={saving}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Getting started…" : "Continue"}
        </button>
      </div>
    </main>
  );
}

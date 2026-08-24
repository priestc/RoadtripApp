"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";
import {
  PreferencesForm,
  type PreferencesFormValues,
} from "@/components/PreferencesForm";
import type { DrivingPreferences } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();

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

  async function handleSubmit(values: PreferencesFormValues) {
    if (!user) return;
    const preferences: DrivingPreferences = {
      ...values,
      onboardingComplete: true,
    };
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
    <main className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Let&apos;s set up your driving preferences
          </h1>
          <p className="mt-1 text-slate-500">
            This helps RoadtripApp plan stops and days that fit how you
            actually like to drive. You can change these any time from
            Preferences.
          </p>
        </div>

        <PreferencesForm onSubmit={handleSubmit} submitLabel="Save and continue" />
      </div>
    </main>
  );
}

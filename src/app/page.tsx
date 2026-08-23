"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup } from "firebase/auth";
import { getFirebaseAuth, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user, authLoading, profile, profileLoading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || profileLoading) return;
    router.replace(profile?.onboardingComplete ? "/dashboard" : "/onboarding");
  }, [user, profile, profileLoading, router]);

  async function handleLogin() {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(getFirebaseAuth(), googleProvider);
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setSigningIn(false);
    }
  }

  if (authLoading || user) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-semibold tracking-tight">RoadtripApp</h1>
        <p className="mt-2 text-slate-500">
          Navigation built for long road trips.
        </p>

        <button
          onClick={handleLogin}
          disabled={signingIn}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <GoogleIcon />
          {signingIn ? "Signing in…" : "Login with Google"}
        </button>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.3-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3c-7.5 0-14 4.2-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.5 0 10.5-2.1 14.2-5.6l-6.6-5.5C29.6 35.6 27 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.9 40.6 16.4 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.5C41.9 35.7 44 30.3 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

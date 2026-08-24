"use client";

import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";

export function NavBar() {
  const { user } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href={user ? "/dashboard" : "/"}
          className="text-lg font-semibold tracking-tight text-slate-900"
        >
          RoadtripApp
        </Link>
        {user && (
          <Link
            href="/preferences"
            className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
          >
            Preferences
          </Link>
        )}
      </div>
    </header>
  );
}

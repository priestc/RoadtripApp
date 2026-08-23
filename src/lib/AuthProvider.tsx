"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import type { DrivingPreferences } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  authLoading: boolean;
  profile: DrivingPreferences | null;
  profileLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authLoading: true,
  profile: null,
  profileLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<DrivingPreferences | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (!firebaseUser) {
        setProfile(null);
        setProfileLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(getFirebaseDb(), "users", user.uid), (snapshot) => {
      setProfile(snapshot.exists() ? (snapshot.data() as DrivingPreferences) : null);
      setProfileLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, authLoading, profile, profileLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

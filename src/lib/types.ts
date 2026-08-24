import type { LunchChoice } from "@/lib/routeDays";

export interface DrivingPreferences {
  onboardingComplete: true;
  homeAddress?: string;
}

export type DeadlineType = "hard" | "soft" | "tbd";

export interface Trip {
  userId: string;
  destination: string;
  departureLocation: string;
  deadlineType: DeadlineType;
  // ISO string: hard = must-arrive-by deadline, soft = planned departure. Null for 'tbd'.
  deadlineDateTime: string | null;
  // ISO string: soft-target trips only, a planned arrival estimate alongside
  // deadlineDateTime's planned departure. Null/absent otherwise.
  plannedArrivalDateTime?: string | null;
  // How many days the drive is split into; unset until the trip page has
  // computed a route and the user has picked (or been defaulted into) a
  // value from the day-count dropdown.
  numDrivingDays?: number;
  // Which of the user's saved vehicles (users/{uid}/vehicles/{id}) this trip uses.
  vehicleId?: string;
  // Current fuel range in miles, as of the start of the trip -- used to
  // place the first fill-up point on the map.
  currentFuelRangeMiles?: number;
  // Per-day lunch choice ("early" = city at the start of the lunch window,
  // "late" = city at the end of it, null = no lunch that day), indexed by
  // day. Unset/shorter-than-days-length entries default to null (no lunch).
  lunchChoicesByDay?: Array<LunchChoice | null>;
  // Firestore server timestamp; typed loosely since the client only ever reads it
  createdAt: unknown;
}

export interface Vehicle {
  name: string;
  fuelCapacityGallons: number;
  gasMileageMpg: number;
  // Firestore server timestamp; typed loosely since the client only ever reads it
  createdAt: unknown;
}

export interface DrivingPreferences {
  maxDrivingHoursPerDay: number;
  earliestDepartureTime: string; // "HH:MM", 24-hour
  latestDepartureTime: string;
  earliestStoppingTime: string;
  latestStoppingTime: string;
  breakfastTime: string | null;
  lunchTime: string;
  dinnerTime: string;
  onboardingComplete: true;
  homeAddress?: string;
}

export type DeadlineType = "hard" | "soft" | "tbd";

export interface Trip {
  userId: string;
  destination: string;
  departureLocation: string;
  deadlineType: DeadlineType;
  // ISO string for 'hard'/'soft', null for 'tbd'
  deadlineDateTime: string | null;
  // Firestore server timestamp; typed loosely since the client only ever reads it
  createdAt: unknown;
}

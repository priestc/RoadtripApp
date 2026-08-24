export interface DrivingPreferences {
  earliestDepartureTime: string; // "HH:MM", 24-hour
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
  // How many days the drive is split into; unset until the trip page has
  // computed a route and the user has picked (or been defaulted into) a
  // value from the day-count dropdown.
  numDrivingDays?: number;
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

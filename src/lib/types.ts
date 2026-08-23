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
}

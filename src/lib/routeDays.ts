export interface RouteDaySegment {
  path: google.maps.LatLngLiteral[];
  durationSeconds: number;
  distanceMeters: number;
}

export interface DailyWindowPreferences {
  maxDrivingHoursPerDay: number;
  earliestDepartureTime: string;
  latestDepartureTime: string;
  earliestStoppingTime: string;
  latestStoppingTime: string;
}

function timeStringToSeconds(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 3600 + (minutes || 0) * 60;
}

function formatSecondsAsClockTime(secondsSinceMidnight: number): string {
  const date = new Date(2000, 0, 1, 0, 0, 0);
  date.setSeconds(secondsSinceMidnight);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Splits a computed driving route into per-day segments, evenly, across
 * however many days the trip needs. Every day is an overnight hotel stay —
 * including the last, since arriving at the final destination on a road
 * trip still means checking into somewhere — so every day is capped by the
 * same ceiling: whichever comes first between the max-comfortable-driving-
 * hours preference, and the largest single-day span achievable between the
 * earliest-comfortable-departure time and the latest-comfortable-stopping
 * time.
 *
 * Long highway routes often have only a handful of Directions API "steps"
 * (e.g. a single "Continue on I-10 E for 300 mi" step can span several
 * hours by itself), so day boundaries can't just snap to step boundaries —
 * that leaves boundaries stranded wherever the few available steps happen
 * to end. Instead, a step that would cross a day boundary is split
 * mid-step: its path and distance are divided proportionally to the time
 * fraction needed to reach the boundary (a reasonable approximation, since
 * per-point timing isn't available within a step).
 */
export function splitRouteIntoDays(
  leg: google.maps.DirectionsLeg,
  preferences: DailyWindowPreferences
): RouteDaySegment[] {
  const maxDaySeconds = (preferences.maxDrivingHoursPerDay || 8) * 3600;
  const widestWindowSeconds =
    timeStringToSeconds(preferences.latestStoppingTime) -
    timeStringToSeconds(preferences.earliestDepartureTime);
  const maxFeasibleDaySeconds =
    widestWindowSeconds > 0
      ? Math.min(maxDaySeconds, widestWindowSeconds)
      : maxDaySeconds;

  const totalDurationSeconds = leg.steps.reduce(
    (sum, step) => sum + (step.duration?.value ?? 0),
    0
  );
  const numDays = Math.max(
    1,
    Math.ceil(totalDurationSeconds / maxFeasibleDaySeconds)
  );
  const targetDaySeconds = totalDurationSeconds / numDays;

  const days: RouteDaySegment[] = [];
  let currentPath: google.maps.LatLngLiteral[] = [];
  let currentDaySeconds = 0;
  let currentDayMeters = 0;
  let dayBoundarySeconds = targetDaySeconds;
  let elapsedSeconds = 0;

  function finishDay() {
    days.push({
      path: currentPath,
      durationSeconds: currentDaySeconds,
      distanceMeters: currentDayMeters,
    });
    const lastPoint = currentPath[currentPath.length - 1];
    currentPath = lastPoint ? [lastPoint] : [];
    currentDaySeconds = 0;
    currentDayMeters = 0;
    dayBoundarySeconds += targetDaySeconds;
  }

  for (const step of leg.steps) {
    let remainingPath = step.path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
    let remainingSeconds = step.duration?.value ?? 0;
    let remainingMeters = step.distance?.value ?? 0;

    while (remainingSeconds > 0) {
      const spaceLeftInDay = dayBoundarySeconds - elapsedSeconds;
      const isFinalDay = days.length >= numDays - 1;

      if (isFinalDay || remainingSeconds <= spaceLeftInDay) {
        // The rest of this step fits in the current day.
        currentPath.push(...remainingPath);
        currentDaySeconds += remainingSeconds;
        currentDayMeters += remainingMeters;
        elapsedSeconds += remainingSeconds;
        remainingSeconds = 0;
      } else {
        // This step crosses a day boundary — split it proportionally.
        const fraction = spaceLeftInDay / remainingSeconds;
        const splitIndex = Math.min(
          Math.max(Math.round(fraction * (remainingPath.length - 1)), 1),
          remainingPath.length - 1
        );
        const firstPart = remainingPath.slice(0, splitIndex + 1);
        const secondPart = remainingPath.slice(splitIndex);

        currentPath.push(...firstPart);
        currentDaySeconds += spaceLeftInDay;
        currentDayMeters += remainingMeters * fraction;
        elapsedSeconds += spaceLeftInDay;
        finishDay();

        remainingSeconds -= spaceLeftInDay;
        remainingMeters -= remainingMeters * fraction;
        remainingPath = secondPart;
      }
    }
  }

  if (currentPath.length > 0) {
    days.push({
      path: currentPath,
      durationSeconds: currentDaySeconds,
      distanceMeters: currentDayMeters,
    });
  }

  return days;
}

export const DAY_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC05",
  "#34A853",
  "#8E24AA",
  "#00ACC1",
  "#FB8C00",
];

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatMiles(meters: number): string {
  const miles = meters / 1609.344;
  return `${Math.round(miles)} mi`;
}

/**
 * Estimates a departure/arrival clock-time window for a driving day. Rather
 * than always leaving at the earliest-comfortable-departure time, this
 * solves for the latest departure that still arrives by the earliest-
 * comfortable-stopping time — i.e. leave only as early as this day's drive
 * actually requires, not out of habit — clamped to stay within the
 * configured departure and stopping windows. This is a generic per-day
 * estimate, not tied to a real calendar date — full schedule tracking
 * against actual trip dates is future work.
 */
export function estimateDayWindow(
  durationSeconds: number,
  preferences: DailyWindowPreferences
): { start: string; end: string } {
  const earliestDepartureSeconds = timeStringToSeconds(
    preferences.earliestDepartureTime
  );
  const latestDepartureSeconds = timeStringToSeconds(
    preferences.latestDepartureTime
  );
  const earliestStoppingSeconds = timeStringToSeconds(
    preferences.earliestStoppingTime
  );

  const idealDepartureSeconds = earliestStoppingSeconds - durationSeconds;
  const departureSeconds = Math.min(
    Math.max(idealDepartureSeconds, earliestDepartureSeconds),
    latestDepartureSeconds
  );
  const arrivalSeconds = departureSeconds + durationSeconds;

  return {
    start: formatSecondsAsClockTime(departureSeconds),
    end: formatSecondsAsClockTime(arrivalSeconds),
  };
}

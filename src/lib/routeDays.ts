export interface RouteDaySegment {
  path: google.maps.LatLngLiteral[];
  durationSeconds: number;
  distanceMeters: number;
}

/**
 * Splits a computed driving route into per-day segments based on a max
 * driving-hours-per-day preference. The total drive time is divided evenly
 * across however many days it takes to stay under the max, so every day
 * ends up with a similar amount of driving.
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
  maxDrivingHoursPerDay: number
): RouteDaySegment[] {
  const maxDayLengthSeconds = (maxDrivingHoursPerDay || 8) * 3600;
  const totalDurationSeconds = leg.steps.reduce(
    (sum, step) => sum + (step.duration?.value ?? 0),
    0
  );
  const numDays = Math.max(
    1,
    Math.ceil(totalDurationSeconds / maxDayLengthSeconds)
  );
  const targetDayLengthSeconds = totalDurationSeconds / numDays;

  const days: RouteDaySegment[] = [];
  let currentPath: google.maps.LatLngLiteral[] = [];
  let currentDaySeconds = 0;
  let currentDayMeters = 0;
  let dayBoundarySeconds = targetDayLengthSeconds;
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
    dayBoundarySeconds += targetDayLengthSeconds;
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
 * Estimates a clock-time window for a driving day, assuming each day starts
 * at the user's preferred earliest-departure time. This is a generic
 * per-day estimate, not tied to a real calendar date — full schedule
 * tracking against actual trip dates is future work.
 */
export function estimateDayWindow(
  earliestDepartureTime: string,
  durationSeconds: number
): { start: string; end: string } {
  const [hours, minutes] = earliestDepartureTime.split(":").map(Number);
  const start = new Date(2000, 0, 1, hours || 0, minutes || 0);
  const end = new Date(start.getTime() + durationSeconds * 1000);
  const format = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { start: format(start), end: format(end) };
}

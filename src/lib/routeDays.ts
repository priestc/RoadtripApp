export interface RouteDaySegment {
  path: google.maps.LatLngLiteral[];
  durationSeconds: number;
}

/**
 * Splits a computed driving route into per-day segments based on a max
 * driving-hours-per-day preference. Day boundaries snap to the nearest
 * direction-step boundary rather than the exact elapsed second, which is a
 * reasonable approximation for visualizing the route on a map.
 */
export function splitRouteIntoDays(
  leg: google.maps.DirectionsLeg,
  maxDrivingHoursPerDay: number
): RouteDaySegment[] {
  const dayLengthSeconds = (maxDrivingHoursPerDay || 8) * 3600;
  const days: RouteDaySegment[] = [];

  let elapsedSeconds = 0;
  let currentDayIndex = 0;
  let currentPath: google.maps.LatLngLiteral[] = [];
  let currentDaySeconds = 0;

  for (const step of leg.steps) {
    const stepDurationSeconds = step.duration?.value ?? 0;
    const stepDayIndex = Math.floor(elapsedSeconds / dayLengthSeconds);

    if (stepDayIndex !== currentDayIndex && currentPath.length > 0) {
      days.push({ path: currentPath, durationSeconds: currentDaySeconds });
      const lastPoint = currentPath[currentPath.length - 1];
      currentPath = [lastPoint];
      currentDaySeconds = 0;
      currentDayIndex = stepDayIndex;
    }

    for (const point of step.path) {
      currentPath.push({ lat: point.lat(), lng: point.lng() });
    }
    currentDaySeconds += stepDurationSeconds;
    elapsedSeconds += stepDurationSeconds;
  }

  if (currentPath.length > 0) {
    days.push({ path: currentPath, durationSeconds: currentDaySeconds });
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

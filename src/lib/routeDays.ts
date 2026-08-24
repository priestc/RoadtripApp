export interface RouteDaySegment {
  path: google.maps.LatLngLiteral[];
  durationSeconds: number;
  distanceMeters: number;
}

/** Hotel checkout time — fixed, not user-configurable. */
export const HOTEL_CHECKOUT_TIME = "11:00";
/** Hotel check-in time — fixed, not user-configurable. */
export const HOTEL_CHECKIN_TIME = "15:00";
/** Shortest sensible driving leg: checkout time to check-in time. */
export const MIN_LEG_HOURS = 4;
/** A driving day longer than this gets an automatic dinner stop. */
export const DINNER_THRESHOLD_HOURS = 8;
/** Fixed window lunch must fall within — not user-configurable. */
export const LUNCH_WINDOW_START = "10:45";
export const LUNCH_WINDOW_END = "14:00";
/** Fixed window dinner must fall within — not user-configurable. */
export const DINNER_WINDOW_START = "16:30";
export const DINNER_WINDOW_END = "19:00";

export function timeStringToSeconds(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 3600 + (minutes || 0) * 60;
}

export function formatSecondsAsClockTime(secondsSinceMidnight: number): string {
  const date = new Date(2000, 0, 1, 0, 0, 0);
  date.setSeconds(secondsSinceMidnight);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function computeDepartureSeconds(totalElapsedSeconds: number): number {
  const checkoutSeconds = timeStringToSeconds(HOTEL_CHECKOUT_TIME);
  const minLegSeconds = MIN_LEG_HOURS * 3600;
  const straddleSeconds = Math.max(0, totalElapsedSeconds - minLegSeconds) / 2;
  return checkoutSeconds - straddleSeconds;
}

export function getRouteDurationSeconds(leg: google.maps.DirectionsLeg): number {
  return leg.steps.reduce((sum, step) => sum + (step.duration?.value ?? 0), 0);
}

const METERS_PER_MILE = 1609.344;

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

/**
 * Finds the point along the full route (not a single day) that's exactly
 * `targetDistanceMeters` of driving from the start — used to place the
 * first fill-up point once the user enters their current fuel range.
 * Returns null if the range covers the whole route (no fill-up needed) or
 * the target is non-positive.
 */
export function findPointAtDistance(
  leg: google.maps.DirectionsLeg,
  targetDistanceMeters: number
): google.maps.LatLngLiteral | null {
  if (targetDistanceMeters <= 0) return null;

  let elapsedMeters = 0;
  for (const step of leg.steps) {
    const stepMeters = step.distance?.value ?? 0;
    if (elapsedMeters + stepMeters >= targetDistanceMeters) {
      const fraction = stepMeters > 0 ? (targetDistanceMeters - elapsedMeters) / stepMeters : 0;
      const path = step.path;
      const index = Math.min(
        Math.max(Math.round(fraction * (path.length - 1)), 0),
        path.length - 1
      );
      const point = path[index];
      return { lat: point.lat(), lng: point.lng() };
    }
    elapsedMeters += stepMeters;
  }

  return null;
}

/**
 * The largest number of days worth offering in the day-count dropdown.
 * Days are split evenly, so this is the largest N for which total/N is
 * still at least the 4-hour minimum leg (checkout time to check-in time) —
 * using ceil here instead would let the evenly-split max option produce
 * days shorter than that floor.
 */
export function getMaxDayOptions(totalDurationSeconds: number): number {
  return Math.max(1, Math.floor(totalDurationSeconds / (MIN_LEG_HOURS * 3600)));
}

/**
 * A reasonable starting selection for the day-count dropdown: the fewest
 * days that keep the average day at 8 hours of driving or less, without
 * exceeding the max number of days the route allows.
 */
export function getDefaultNumDays(
  totalDurationSeconds: number,
  maxDays: number
): number {
  const comfortable = Math.max(1, Math.ceil(totalDurationSeconds / (8 * 3600)));
  return Math.min(comfortable, maxDays);
}

/**
 * Splits a computed driving route into exactly `numDays` even segments —
 * the day count is a direct user choice (via a dropdown on the trip page),
 * not derived from any driving-comfort preference.
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
  numDays: number
): RouteDaySegment[] {
  const totalDurationSeconds = getRouteDurationSeconds(leg);
  const safeNumDays = Math.max(1, Math.round(numDays));
  const targetDaySeconds = totalDurationSeconds / safeNumDays;

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
      const isFinalDay = days.length >= safeNumDays - 1;

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
  const miles = meters / METERS_PER_MILE;
  return `${Math.round(miles)} mi`;
}

export type MealStop = "Lunch" | "Dinner";

/** How long a lunch stop takes. */
export const LUNCH_DURATION_MINUTES = 45;
/** How long a dinner stop takes. */
export const DINNER_DURATION_MINUTES = 75;

export function getMealStopDurationSeconds(meal: MealStop): number {
  return (meal === "Lunch" ? LUNCH_DURATION_MINUTES : DINNER_DURATION_MINUTES) * 60;
}

function getMealWindowSeconds(meal: MealStop): { start: number; end: number } {
  const [startTime, endTime] =
    meal === "Lunch"
      ? [LUNCH_WINDOW_START, LUNCH_WINDOW_END]
      : [DINNER_WINDOW_START, DINNER_WINDOW_END];
  return {
    start: timeStringToSeconds(startTime),
    end: timeStringToSeconds(endTime),
  };
}

/**
 * Whether a driving day gets an automatic dinner stop, based purely on how
 * long the day's drive is. Breakfast is never an in-route stop (it always
 * happens before the day's drive starts). Lunch is not automatic — the user
 * picks a specific restaurant found via a search along the day's route (see
 * the /api/places/lunch-search route), and its clock time is computed with
 * secondsAtDrivingFraction below.
 */
export function hasDinnerStop(durationSeconds: number): boolean {
  return durationSeconds > DINNER_THRESHOLD_HOURS * 3600;
}

/**
 * A day's baseline departure time — i.e. as if it had no lunch stop at all
 * (though still with its automatic dinner, if any). Used as the reference
 * point for converting a driving-path fraction into a clock time before a
 * lunch stop has been chosen (once one is chosen, its own fixed time and
 * position are used instead — see buildDayItinerary).
 */
export function getBaselineDepartureSeconds(
  drivingDurationSeconds: number,
  dayHasDinner: boolean
): number {
  const dinnerSeconds = dayHasDinner ? getMealStopDurationSeconds("Dinner") : 0;
  return computeDepartureSeconds(drivingDurationSeconds + dinnerSeconds);
}

/**
 * Converts a 0..1 position along a day's driving path into an estimated
 * clock time, against that day's baseline (no-lunch) schedule — used to
 * show an ETA for each restaurant found along the route before any lunch
 * stop has been chosen.
 */
export function secondsAtDrivingFraction(
  drivingDurationSeconds: number,
  dayHasDinner: boolean,
  fraction: number
): number {
  const baselineDeparture = getBaselineDepartureSeconds(
    drivingDurationSeconds,
    dayHasDinner
  );
  return baselineDeparture + fraction * drivingDurationSeconds;
}

export interface DayItineraryStop {
  label: "Departure" | MealStop | "Arrival";
  secondsSinceMidnight: number;
  /** 0..1 position along the day's driving path, for picking a point to reverse-geocode. */
  drivingFraction: number;
}

/** A specific restaurant picked as a day's lunch stop, from the results of
 * a search along that day's route. */
export interface LunchSelection {
  placeId: string;
  name: string;
  type: string;
  /** The restaurant's actual coordinates, for placing its map marker exactly. */
  lat: number;
  lng: number;
  drivingFraction: number;
  secondsSinceMidnight: number;
}

/**
 * Validates a value loaded from Firestore actually matches LunchSelection's
 * shape. Firestore doesn't enforce a schema, and this shape has changed
 * more than once (originally just "early"/"late" strings, then an object
 * without lat/lng) -- a trip saved under an older version would otherwise
 * pass a malformed object all the way to the Maps SDK, which throws a hard,
 * uncaught error on an invalid marker position rather than failing softly.
 */
export function isLunchSelection(value: unknown): value is LunchSelection {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.placeId === "string" &&
    typeof v.name === "string" &&
    typeof v.type === "string" &&
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    typeof v.drivingFraction === "number" &&
    typeof v.secondsSinceMidnight === "number"
  );
}

/**
 * Builds the full stop-by-stop itinerary for a driving day: departure, an
 * optional lunch stop (only if the user picked a specific restaurant from
 * the search-along-route results), an optional automatic dinner stop, and
 * arrival.
 *
 * Lunch, when chosen, is pinned exactly to its position/time — no further
 * adjustment — since that's literally where the selected restaurant is.
 * Dinner, still automatic, is placed at the midpoint of whatever driving
 * remains after lunch (or the midpoint of the whole day if no lunch was
 * chosen) and then clamped into its fixed window (DINNER_WINDOW_START..END).
 * Meal-stop durations (LUNCH_DURATION_MINUTES, DINNER_DURATION_MINUTES) are
 * added at each stop, and departure/arrival straddle the fixed 11:00 AM
 * checkout / 3:00 PM check-in anchors based on total driving + stop time
 * (see splitRouteIntoDays' module doc for the straddle logic). This is a
 * generic per-day estimate, not tied to a real calendar date — full
 * schedule tracking against actual trip dates is future work.
 */
export function buildDayItinerary(
  drivingDurationSeconds: number,
  dayHasDinner: boolean,
  lunch: { drivingFraction: number; secondsSinceMidnight: number } | null
): DayItineraryStop[] {
  const lunchSeconds = lunch ? getMealStopDurationSeconds("Lunch") : 0;
  const dinnerSeconds = dayHasDinner ? getMealStopDurationSeconds("Dinner") : 0;
  const totalElapsedSeconds = drivingDurationSeconds + lunchSeconds + dinnerSeconds;
  const departureSeconds = computeDepartureSeconds(totalElapsedSeconds);

  const stops: DayItineraryStop[] = [
    { label: "Departure", secondsSinceMidnight: departureSeconds, drivingFraction: 0 },
  ];

  let clock = departureSeconds;
  let drivenFraction = 0;

  if (lunch) {
    clock = lunch.secondsSinceMidnight;
    drivenFraction = lunch.drivingFraction;
    stops.push({
      label: "Lunch",
      secondsSinceMidnight: clock,
      drivingFraction: drivenFraction,
    });
    clock += lunchSeconds;
  }

  const remainingDrivingSeconds = (1 - drivenFraction) * drivingDurationSeconds;

  if (dayHasDinner) {
    const drivingToDinner = remainingDrivingSeconds / 2;
    clock += drivingToDinner;

    const window = getMealWindowSeconds("Dinner");
    clock = Math.min(Math.max(clock, window.start), window.end);

    drivenFraction +=
      drivingDurationSeconds > 0 ? drivingToDinner / drivingDurationSeconds : 0;
    stops.push({
      label: "Dinner",
      secondsSinceMidnight: clock,
      drivingFraction: drivenFraction,
    });
    clock += dinnerSeconds;
    clock += remainingDrivingSeconds - drivingToDinner;
  } else {
    clock += remainingDrivingSeconds;
  }

  stops.push({ label: "Arrival", secondsSinceMidnight: clock, drivingFraction: 1 });

  return stops;
}

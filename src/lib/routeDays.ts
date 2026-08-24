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
/** A driving day longer than this gets an automatic lunch stop. */
export const LUNCH_THRESHOLD_HOURS = 4;
/** A driving day longer than this also gets an automatic dinner stop. */
export const DINNER_THRESHOLD_HOURS = 8;
/** Fixed window lunch must fall within — not user-configurable. */
export const LUNCH_WINDOW_START = "10:45";
export const LUNCH_WINDOW_END = "14:00";
/** Fixed window dinner must fall within — not user-configurable. */
export const DINNER_WINDOW_START = "16:30";
export const DINNER_WINDOW_END = "19:00";

function timeStringToSeconds(time: string): number {
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
 * Which meal stops a driving day gets, based purely on how long the day's
 * drive is. Breakfast isn't included here — it always happens before the
 * day's drive starts, so it's never an in-route stop.
 */
export function getMealStops(durationSeconds: number): MealStop[] {
  const stops: MealStop[] = [];
  if (durationSeconds > LUNCH_THRESHOLD_HOURS * 3600) stops.push("Lunch");
  if (durationSeconds > DINNER_THRESHOLD_HOURS * 3600) stops.push("Dinner");
  return stops;
}

export interface DayItineraryStop {
  label: "Departure" | MealStop | "Arrival";
  secondsSinceMidnight: number;
  /** 0..1 position along the day's driving path, for picking a point to reverse-geocode. */
  drivingFraction: number;
}

/**
 * Builds the full stop-by-stop itinerary for a driving day: departure, any
 * meal stops, and arrival, each with a clock time. Meal stops are spaced
 * evenly through the day's driving to start (e.g. with one meal stop, it
 * falls at the midpoint of the drive; with two, driving is split into
 * thirds), then each meal's clock time is clamped into its fixed real-world
 * window (LUNCH_WINDOW_START..END, DINNER_WINDOW_START..END) — lunch always
 * lands between 10:45 AM and 2:00 PM, dinner between 4:30 PM and 7:00 PM,
 * regardless of where the even split would otherwise put it. Whatever
 * adjustment the clamp makes carries forward to every later stop, so the
 * schedule stays internally consistent (a meal pushed later by its window
 * pushes the rest of the day later too); the driving-path fraction used to
 * geocode/place each stop is unaffected by clamping, since that's a
 * position, not a time.
 *
 * Meal-stop durations (LUNCH_DURATION_MINUTES, DINNER_DURATION_MINUTES)
 * are added at each stop, and departure/arrival straddle the fixed 11:00 AM
 * checkout / 3:00 PM check-in anchors based on total driving + stop time
 * (see splitRouteIntoDays' module doc for the straddle logic). This is a
 * generic per-day estimate, not tied to a real calendar date — full
 * schedule tracking against actual trip dates is future work.
 */
export function buildDayItinerary(
  drivingDurationSeconds: number,
  mealStops: MealStop[]
): DayItineraryStop[] {
  const totalStopSeconds = mealStops.reduce(
    (sum, meal) => sum + getMealStopDurationSeconds(meal),
    0
  );
  const totalElapsedSeconds = drivingDurationSeconds + totalStopSeconds;
  const departureSeconds = computeDepartureSeconds(totalElapsedSeconds);

  const segments = mealStops.length + 1;
  const drivingPerSegment = drivingDurationSeconds / segments;

  const stops: DayItineraryStop[] = [
    { label: "Departure", secondsSinceMidnight: departureSeconds, drivingFraction: 0 },
  ];

  let clock = departureSeconds;
  let driven = 0;
  for (const meal of mealStops) {
    driven += drivingPerSegment;
    clock += drivingPerSegment;

    const { start, end } = getMealWindowSeconds(meal);
    clock = Math.min(Math.max(clock, start), end);

    stops.push({
      label: meal,
      secondsSinceMidnight: clock,
      drivingFraction: driven / drivingDurationSeconds,
    });
    clock += getMealStopDurationSeconds(meal);
  }
  clock += drivingPerSegment;
  stops.push({ label: "Arrival", secondsSinceMidnight: clock, drivingFraction: 1 });

  return stops;
}

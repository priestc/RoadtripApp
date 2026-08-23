# RoadtripApp — Design Notes

A navigation app similar to Google Maps / Apple Maps / Waze, purpose-built for long road trips. The core differentiator isn't turn-by-turn (that part works like any other nav app) — it's automatic management of fuel stops, meal stops, rest stops, and (for multi-day trips) overnight stays, plus optional deadline tracking that actively keeps you on schedule.

This document captures product/behavior decisions made so far. No implementation has started; this is intentionally pre-code.

## Trip lifecycle

Trips move through three phases:

1. **Trip setup** (days/weeks ahead) — destination, dates, one-way vs. round-trip, deadline type, vehicle selection.
2. **Departure-time finalization** — opened right before leaving (and, for multi-day trips, again each morning). Pulls live data (traffic, gas prices, restaurant hours/availability, hotel availability) and computes the actual stop plan for that day, presenting the primary plan plus alternatives.
3. **In-route monitoring** — continuous schedule tracking and stop management while driving, using the rules below.

Gas prices are assumed static for the day once fetched at departure-time finalization (MVP simplification — no mid-day repricing yet).

## Trip setup flow

- Destination
- One-way or round trip (round trip asks for the return date)
- Timing: soft target date/time (leave-by or arrive-by — used for planning stops, no alarm if missed)
- Hard deadline (optional, separate from the soft target): a real deadline (e.g. a flight, a wedding) that triggers aggressive schedule-tracking behavior if missed would actually matter
- Vehicle selection (from saved profile vehicles, see below)
- Current fuel level (fraction of tank or gallons, not a raw "range" guess — the app derives range from the selected vehicle's stored capacity/mpg)

## User profile

Persistent, reused across trips. Food and driving-time preferences are account-level defaults that get inherited into every new trip, but remain editable per trip (a trip-level override doesn't change the account default).

- **Vehicles** (multiple supported, one selected per trip): fuel range, mpg (city/highway), tank capacity
- **Meal preferences**: preferred time windows for breakfast/lunch/dinner, and preferred place type/cuisine per meal, editable per trip
- **Driving comfort**: max comfortable driving hours per day; preferred stop frequency; earliest/latest comfortable departure time each day (default latest: 11am, typical hotel checkout time); earliest/latest comfortable stopping time each day (default earliest: 3pm, typical hotel check-in time; default latest: sunset) — editable per trip
- **Hotel budget**: target per-night budget for multi-day trips
- **Learned stop durations**: the app tracks actual time spent at each stop and builds personal averages over time, tracked per stop type (fuel / meal / rest / hotel check-in) and, within meal stops, per venue category (fast food / sit-down / coffee) since typical duration varies a lot by category. Early trips fall back to generic estimates until enough personal data accumulates; used to make schedule/deadline projections realistic instead of relying on generic assumptions.

## Platforms & clients

Two client surfaces share one backend and data model, split by use case rather than by feature-completeness:

- **iOS app** — the on-the-road surface, used mostly for on-the-fly interaction while driving or stopped. Embedded turn-by-turn nav, missed-stop substitution notices, confirm-first prompts (skip a stop, exceed the driving-hours ceiling, switch fuel mode), the extend/shorten leg buttons, the fuel-range widget and quick-adjust, Siri Shortcut recalibration, and end-of-day summaries/alerts. Optimized for glanceable, low-friction, mostly-one-handed interaction.
- **Web app** — the detailed planning surface, designed for mouse+keyboard on a large screen. This is where trip setup happens (destination, dates, deadline, vehicle, preference overrides), and it's what the end-of-day email's "plan tomorrow" link opens — letting the user pick among proposed meal options and adjust the next day's parameters with more room than a phone screen affords.
- Both clients read/write the same trip, profile, and vehicle data via a shared backend, so a change made on the web (e.g. picking tomorrow's lunch stop) is reflected in the iOS app the next morning, and vice versa.

## Navigation architecture

- **Embedded navigation SDK** (Google Navigation SDK or Mapbox Navigation SDK — both support iOS and Android) rather than deep-linking to Google/Apple Maps. Apple doesn't offer an embeddable turn-by-turn SDK to third parties, so embedding at all means picking Google or Mapbox regardless of phone OS. This choice is what allows dynamic waypoint insertion/reordering (fuel/meal/rest/hotel stops) mid-drive rather than only handing off a single fixed destination.
- **Mobile platform**: iOS first.
- Background location tracking runs independent of whichever screen is frontmost, which is what makes deadline tracking and "time to leave" alerts possible even while the embedded nav view is active.

## Fuel engine

Two operating modes, chosen automatically based on schedule status on deadline trips (no deadline, or ahead of/on schedule on a deadline trip → optimize mode; behind schedule on a deadline trip → minimize-stops mode). Mode is not switched silently — the app prompts the user before switching to minimize-stops behavior ("you're behind schedule, skip to a faster stop to save time?").

**Optimize mode** (price-first):
- If current range can reach the single cheapest station along the route, route directly there.
- If the cheapest station is out of range, route to the cheapest station reachable within current range (with a safety buffer), and tell the user to buy only the calculated amount of fuel needed to bridge to the actual cheapest station further down the route, where they fill up completely. This avoids overpaying by "topping off" at a mediocre-price station when a much better price is only slightly out of reach.

**Minimize-stops mode** (time-first, behind schedule on a hard deadline):
- Route to whichever viable station minimizes total number of stops, even at a higher price.
- Rest/stretch stops are candidates to skip to protect the deadline, but per the confirm-first rule below, skipping is proposed to the user rather than done silently.

**Range estimation & recalibration** — iOS gives no API to read a vehicle's actual fuel level/range (true even via CarPlay, short of manufacturer-specific telematics or an OBD dongle, which is out of scope for now). So range is estimated and needs easy recalibration:
- Between updates, range is dead-reckoned by decrementing miles driven ÷ vehicle's stored mpg.
- The app detects likely fill-ups via geofence + dwell time at gas-station POIs and proactively prompts for an updated level/range right after leaving.
- Hands-free recalibration via Siri Shortcut / voice command, so a driver can update the estimate off their dashboard's own distance-to-empty readout without touching the phone.
- A home/lock-screen widget shows current estimated range at a glance with a large quick-adjust tap target.
- The safety buffer used in fuel routing math widens the longer it's been (miles/time) since the last real calibration, reflecting growing estimate uncertainty rather than using a fixed margin.

## Stop types and the "never go backwards" rule

Stop types: fuel, meal, rest/stretch, hotel (multi-day trips). All stops follow one global rule: **the app never routes you backwards unless there is no forward option, and even then only with explicit user confirmation.**

- If a planned stop is missed (e.g. missed the exit for a planned Chipotle), the app detects it via GPS passing the stop's decision point without diverting, and automatically substitutes the next equivalent option further ahead (same chain preferred, falling back to same category/cuisine) — done silently, since this is a substitution of the same planned stop, not a removal.
- Backtracking is the last resort, used only when no viable option exists ahead, and requires explicit user confirmation before routing backwards.

## Deadline tracking and the autonomous-replan / confirm-first split

On hard-deadline trips, the app actively tracks pace against the deadline (using learned stop durations for realistic projections) and can autonomously recompute the schedule/route in the background. But there's a consistent split:

- **Plan recalculation** (schedule math, rerouting, which fuel mode is active) happens autonomously — the app just does it and shows the result.
- **Anything that removes, shrinks, or exceeds a personal limit** — skipping/shrinking a meal stop, skipping a rest stop, switching fuel engine mode, or exceeding the user's normal daily driving-hours comfort limit to make up time — is proposed as a one-tap confirmation prompt rather than applied silently. Meal stops specifically are always asked about individually rather than auto-skipped, since they're more personal/negotiable than rest stops.

## Multi-day trips

- **Auto-segmentation**: if total driving distance/time exceeds the user's max-comfortable-driving-hours preference, the app automatically splits the trip into day-segments sized to that preference. Each day's segment is also bounded by the departure/stopping time-of-day windows above — e.g. a day can't start before the earliest-comfortable-departure time or run past the latest-comfortable-stopping time, even if max-driving-hours alone would allow it.
- At the end of each day's leg, the app finds a hotel near that endpoint matching the user's per-night budget target and routes to it (same "recommend + route" pattern as fuel/meal/rest stops — **no booking/payment integration for now**, the user checks in themselves; the data model should stay open to add real booking as a later phase).
- The departure-time finalization phase (pull live data, compute the day's plan + alternatives) repeats each morning of a multi-day trip, not just once at the start.

**End-of-day email checkpoint**: at the end of each driving day, the app sends an email summarizing that day — all stops made, and how far ahead of/behind schedule the day ended. The email includes a link into the next day's itinerary, where the user can make selections for that day (e.g. choosing among scheduled meal options) before departure-time finalization runs the next morning.

**Deadline aggressiveness is last-day-only.** For multi-day trips, the aggressive behaviors defined above (minimize-stops fuel mode, skipping rest stops, confirm-first prompts to cut stops) only activate on the trip's final driving day. On earlier days, falling behind schedule does not trigger stop-cutting — it's absorbed by replanning instead (below). This means a single-day trip is always effectively "the last day," so aggressive behavior can still kick in immediately if it's a hard-deadline trip.

**Falling behind (or ahead) on a non-final day — proportional replanning**: rather than tracking an accumulating time deficit, the app recomputes the remaining day-segments from scratch whenever schedule status changes meaningfully — re-dividing all remaining driving distance evenly across all remaining days. This is symmetric and self-correcting: falling behind raises each remaining day's driving target, running ahead lowers it, all without separate deficit-tracking state.

- **Soft-target trips** (no hard deadline): the max-comfortable-driving-hours ceiling always wins. If proportional replanning would need to push a day's driving past that ceiling to stay on the original day-count, the app adds an extra day to the trip instead and re-divides across the new, larger number of days — trading a longer trip for comfortable days rather than forcing long catch-up days.
- **Hard-deadline trips**: the day count is fixed by the deadline and can't be extended, so the max-comfortable-hours ceiling can't always be honored this way. This is exactly why deadline aggressiveness (minimize-stops fuel mode, skipping rest stops) exists and is reserved for the final day — it's the release valve when redistribution alone can't close the gap without breaking the deadline.

**Manual "extend leg" / "shorten leg" controls**: a button in-app lets the user manually override today's driving target in either direction — feeling good and want to push further, or not feeling like a full day. This is a user-initiated trigger for the same proportional replanning used for automatic schedule drift: extending or shortening today's leg re-divides the *remaining* distance across the *remaining* days (still subject to the extra-day-instead-of-overlong-days rule for soft-target trips). "Extend leg" is explicitly the one path where the user can push a day past their own max-comfortable-hours ceiling — it's opt-in, so the ceiling that otherwise always wins for automatic replanning doesn't apply when the user is the one asking for it. Using either button also shifts that day's hotel search to match the new stopping point.

## Timezone handling

Crossing a timezone must never cause the user to silently lose or gain an hour anywhere in the app's math or displays. This means keeping two kinds of time strictly separate:

- **Elapsed time / duration math** (driving hours accumulated, schedule ahead/behind calculations, learned stop durations) is always computed from absolute timestamps (e.g. UTC), never by subtracting two displayed local clock times. A stop that started at 2:00pm Central and ended at 2:40pm Eastern is a 40-minute stop plus a timezone jump, not a 40-minute stop that happens to also show a 1-hour jump on the clock.
- **Wall-clock preferences** (earliest/latest comfortable departure and stopping times, meal time windows) describe a time-of-day, and must be reinterpreted against whichever timezone the car is currently/about to be in — not the timezone the trip started in. If "latest comfortable stopping time" is sunset and a timezone line is crossed mid-afternoon, the app re-evaluates against the new local sunset, not the origin timezone's.
- **Deadlines and soft-target dates/times** are interpreted in the **destination's** timezone (e.g. "arrive by 5pm Friday" means 5pm at the destination), matching how people naturally think about arrival deadlines like a flight or a venue closing time.
- **The end-of-day email and next-day itinerary** display times in whatever timezone the user physically stopped in for the night, not the origin timezone.
- The app should proactively surface a brief notice when a timezone change occurs mid-drive (similar in spirit to how phones already do this for the system clock), since it affects the deadline countdown and today's remaining stopping window.

## Open areas not yet decided

- Data sources for live fuel prices and restaurant/hotel candidates (e.g. GasBuddy-style pricing feed vs. Google Places), and fallback behavior when that data is stale or unavailable mid-route.
- The exact "time to leave" detection mechanism (geofence vs. speed-based stop detection) and the full alert escalation ladder (gentle → urgent → "leave now").
- Whether return-leg stops for round trips are planned in full at trip setup or left to departure-time finalization on the return date.
- iOS background-location permission constraints and how much they limit "time to leave" / schedule-tracking reliability while the phone is locked or another app (e.g. the embedded nav view) is frontmost.
- Whether vehicle mpg should account for city vs. highway split dynamically based on detected driving context, or just use a single stored highway mpg value as a simplification.
- Email delivery mechanism for the end-of-day checkpoint (transactional email provider).
- Whether the web app ships alongside the iOS app for MVP, or the iOS app launches first with next-day parameter selection handled in-app as a stopgap until the web app exists.

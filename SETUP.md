# Setup

One-time setup to get Google sign-in and the onboarding flow working locally.

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and click **Add project**.
2. Name it whatever you like (e.g. "RoadtripApp") and finish the wizard (Google Analytics is optional, not needed here).

## 2. Enable Google sign-in

1. In the Firebase console, go to **Build → Authentication → Sign-in method**.
2. Click **Google** in the provider list, enable it, set a support email, and save.

## 3. Create a Firestore database

1. Go to **Build → Firestore Database → Create database**.
2. Choose a location, and start in **test mode** for now (test mode allows open read/write — this is fine for local development only; production rules restricting access to `request.auth.uid` will need to be added before this ships to real users).

## 4. Get your web app config

1. In the Firebase console, go to **Project settings** (gear icon) → scroll to **Your apps**.
2. Click the web icon (`</>`) to register a new web app (any nickname is fine, no hosting setup needed).
3. Firebase will show a `firebaseConfig` object — you'll need the values from it in the next step.

## 5. Configure your local environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in each value from the `firebaseConfig` object you got in step 4:

| `.env.local` variable                     | `firebaseConfig` key |
| ------------------------------------------ | --------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | `apiKey`               |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | `authDomain`           |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | `projectId`            |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | `storageBucket`        |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId`    |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | `appId`                |

## 6. Set up Google Maps Platform (needed for the trip route map)

Trip pages draw the driving route using the Google Maps JavaScript API and Directions API, look up the nearest city name for each day's start/end point using the Geocoding API, and the address fields (home address, trip destination/departure) use the Places API for autocomplete. This is a different key from your Firebase config, though it can live in the same underlying Google Cloud project.

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and select the project matching your Firebase project (Firebase projects are Google Cloud projects — pick the same project ID/name).
2. **Enable billing** on this project: Maps Platform requires a billing account attached, even though Google gives a recurring monthly credit that covers light usage. Go to **Billing** in the left sidebar and link or create a billing account.
3. Go to **APIs & Services → Library** and enable all five:
   - **Maps JavaScript API**
   - **Directions API**
   - **Places API**
   - **Places API (New)** — required for the address autocomplete widget specifically; the legacy "Places API" widget hasn't been available to new Google Cloud projects since March 2025
   - **Geocoding API**
4. Go to **APIs & Services → Credentials → Create Credentials → API key**. Copy the generated key.
5. (Recommended) Click into the new key and restrict it: under "API restrictions" limit it to just the five APIs above, and under "Application restrictions" limit it to your app's HTTP referrers (e.g. `localhost:3000/*`, and your production domain once you have one) so it can't be used elsewhere if it leaks.
6. Add it to `.env.local`:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-key-here
```

Without this, trip pages will still load, but the map area will show a placeholder message instead of a real map.

## 7. Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Login with Google**, complete the onboarding form, then use **Add new trip** on the dashboard to create a trip and see its route mapped out by day.

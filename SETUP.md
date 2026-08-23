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

## 6. Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Login with Google**, complete the onboarding form, and you should land on the placeholder dashboard with your saved preferences.

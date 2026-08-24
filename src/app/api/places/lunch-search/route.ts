import { NextRequest, NextResponse } from "next/server";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface TextSearchPlace {
  id: string;
  displayName?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
}

export interface LunchSearchResult {
  placeId: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
}

/**
 * Searches for restaurants along a driving route (Places API (New) Text
 * Search's "search along route" feature) — not available in the
 * client-side Places JS library, only the REST endpoint, hence this proxy.
 */
export async function POST(request: NextRequest) {
  if (!GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key not configured." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const encodedPolyline = body?.encodedPolyline;
  if (typeof encodedPolyline !== "string" || !encodedPolyline) {
    return NextResponse.json(
      { error: "Missing encodedPolyline." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.primaryTypeDisplayName,places.location",
      },
      body: JSON.stringify({
        textQuery: "restaurant",
        maxResultCount: 20,
        searchAlongRouteParameters: {
          polyline: { encodedPolyline },
        },
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Places search failed." },
        { status: 502 }
      );
    }

    const data: { places?: TextSearchPlace[] } = await res.json();
    const results: LunchSearchResult[] = (data.places ?? [])
      .filter(
        (place) =>
          place.location?.latitude != null && place.location?.longitude != null
      )
      .map((place) => ({
        placeId: place.id,
        name: place.displayName?.text ?? "Unnamed restaurant",
        type: place.primaryTypeDisplayName?.text ?? "Restaurant",
        lat: place.location!.latitude!,
        lng: place.location!.longitude!,
      }));

    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Places search failed." },
      { status: 502 }
    );
  }
}

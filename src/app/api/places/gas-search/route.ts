import { NextRequest, NextResponse } from "next/server";
import { ApiCache } from "@/lib/apiCache";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface Money {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}

interface FuelPrice {
  type?: string;
  price?: Money;
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface TextSearchPlace {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  fuelOptions?: { fuelPrices?: FuelPrice[] };
  addressComponents?: AddressComponent[];
}

export interface GasSearchResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  pricePerGallon: number;
  /** "City, ST", or null if no locality-level component was found. */
  city: string | null;
}

function moneyToNumber(money: Money): number {
  return Number(money.units ?? 0) + (money.nanos ?? 0) / 1_000_000_000;
}

/** Pulls a "City, State" label out of Places address components, falling
 * back to progressively broader area types for the city part if there's no
 * exact locality (e.g. a station out in the countryside). */
function extractCity(components: AddressComponent[] | undefined): string | null {
  if (!components) return null;
  const cityTypes = [
    "locality",
    "administrative_area_level_3",
    "administrative_area_level_2",
  ];
  let city: string | null = null;
  for (const type of cityTypes) {
    const component = components.find((c) => c.types?.includes(type));
    if (component?.longText) {
      city = component.longText;
      break;
    }
  }
  if (!city) return null;

  const state = components.find((c) =>
    c.types?.includes("administrative_area_level_1")
  );
  return state?.shortText ? `${city}, ${state.shortText}` : city;
}

// Gas prices change more often than restaurant listings, so this cache is
// much shorter-lived than the lunch-search cache -- a station's price is
// reused for up to an hour, then re-fetched.
const gasSearchCache = new ApiCache<GasSearchResult[]>(60 * 60 * 1000);

/**
 * Searches for gas stations along a driving route with current regular
 * unleaded pricing (Places API (New) Text Search's "search along route"
 * feature plus its fuelOptions field) -- same proxy pattern as
 * /api/places/lunch-search, since this isn't available client-side.
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

  const cached = gasSearchCache.get(encodedPolyline);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.fuelOptions,places.addressComponents",
      },
      body: JSON.stringify({
        textQuery: "gas station",
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
    const results: GasSearchResult[] = (data.places ?? [])
      .map((place) => {
        const regular = place.fuelOptions?.fuelPrices?.find(
          (fp) => fp.type === "REGULAR_UNLEADED"
        );
        if (
          !regular?.price ||
          place.location?.latitude == null ||
          place.location?.longitude == null
        ) {
          return null;
        }
        return {
          placeId: place.id,
          name: place.displayName?.text ?? "Unnamed gas station",
          lat: place.location.latitude,
          lng: place.location.longitude,
          pricePerGallon: moneyToNumber(regular.price),
          city: extractCity(place.addressComponents),
        };
      })
      .filter((result): result is GasSearchResult => result !== null);

    gasSearchCache.set(encodedPolyline, results);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: "Places search failed." },
      { status: 502 }
    );
  }
}

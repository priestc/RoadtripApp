import { NextRequest, NextResponse } from "next/server";
import { fetchMenu } from "@/lib/fuelEconomyApi";

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("year");
  const make = request.nextUrl.searchParams.get("make");
  const model = request.nextUrl.searchParams.get("model");
  if (!year || !make || !model) {
    return NextResponse.json(
      { error: "Missing year, make, or model" },
      { status: 400 }
    );
  }
  try {
    const options = await fetchMenu("options", { year, make, model });
    return NextResponse.json(options);
  } catch {
    return NextResponse.json(
      { error: "Couldn't load vehicle configurations." },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchMenu } from "@/lib/fuelEconomyApi";

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("year");
  const make = request.nextUrl.searchParams.get("make");
  if (!year || !make) {
    return NextResponse.json(
      { error: "Missing year or make" },
      { status: 400 }
    );
  }
  try {
    const models = await fetchMenu("model", { year, make });
    return NextResponse.json(models);
  } catch {
    return NextResponse.json(
      { error: "Couldn't load models." },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchMenu } from "@/lib/fuelEconomyApi";

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("year");
  if (!year) {
    return NextResponse.json({ error: "Missing year" }, { status: 400 });
  }
  try {
    const makes = await fetchMenu("make", { year });
    return NextResponse.json(makes);
  } catch {
    return NextResponse.json(
      { error: "Couldn't load makes." },
      { status: 502 }
    );
  }
}

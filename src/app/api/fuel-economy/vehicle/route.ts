import { NextRequest, NextResponse } from "next/server";
import { fetchVehicleCombinedMpg } from "@/lib/fuelEconomyApi";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  try {
    const combinedMpg = await fetchVehicleCombinedMpg(id);
    return NextResponse.json({ combinedMpg });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load MPG for this vehicle." },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import { fetchMenu } from "@/lib/fuelEconomyApi";

export async function GET() {
  try {
    const years = await fetchMenu("year", {});
    return NextResponse.json(years);
  } catch {
    return NextResponse.json(
      { error: "Couldn't load model years." },
      { status: 502 }
    );
  }
}

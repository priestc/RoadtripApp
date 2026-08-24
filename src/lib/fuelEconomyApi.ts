const BASE_URL = "https://www.fueleconomy.gov/ws/rest";

export interface MenuOption {
  label: string;
  value: string;
}

interface RawMenuItem {
  text: string;
  value: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`fueleconomy.gov request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchMenu(
  path: string,
  params: Record<string, string>
): Promise<MenuOption[]> {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/vehicle/menu/${path}${query ? `?${query}` : ""}`;
  const data = await fetchJson<{ menuItem?: RawMenuItem | RawMenuItem[] }>(
    url
  );
  const raw = data.menuItem;
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => ({ label: item.text, value: item.value }));
}

export async function fetchVehicleCombinedMpg(id: string): Promise<number> {
  const data = await fetchJson<{ comb08?: string }>(
    `${BASE_URL}/vehicle/${encodeURIComponent(id)}`
  );
  const mpg = Number(data.comb08);
  if (!Number.isFinite(mpg) || mpg <= 0) {
    throw new Error("No combined MPG available for this vehicle");
  }
  return mpg;
}

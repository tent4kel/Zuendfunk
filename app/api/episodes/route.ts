import { NextResponse } from "next/server";
import { getEpisodes, secondsUntilNextRefresh } from "../../../lib/br";

export const runtime = "nodejs";

export async function GET() {
  try {
    const episodes = await getEpisodes();
    const maxAge = secondsUntilNextRefresh();

    return NextResponse.json(
      { episodes, updatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=86400`
        }
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ episodes: [], error: "BR-Daten konnten nicht geladen werden." }, { status: 502 });
  }
}

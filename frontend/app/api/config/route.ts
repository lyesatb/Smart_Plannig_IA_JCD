import { NextResponse } from "next/server";

import { normalizeApiUrl } from "../../../lib/normalize-api-url";

/** URL backend lue côté serveur Vercel (modifiable sans rebuild client). */
export async function GET() {
  const apiUrl = normalizeApiUrl(
    process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || null,
  );

  return NextResponse.json({ apiUrl });
}

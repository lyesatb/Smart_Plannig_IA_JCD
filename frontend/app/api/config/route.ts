import { NextResponse } from "next/server";

/** URL backend lue côté serveur Vercel (modifiable sans rebuild client). */
export async function GET() {
  const apiUrl =
    process.env.API_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    null;

  return NextResponse.json({ apiUrl });
}

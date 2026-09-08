import { hasValidSession } from "@/lib/session";

export async function GET(request: Request) {
  return Response.json({ authenticated: await hasValidSession(request) });
}

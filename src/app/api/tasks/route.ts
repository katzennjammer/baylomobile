import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/api-auth";
import { reconcileTasks } from "@/lib/tasks";

// Backfill endpoint. Awards are event-driven at their trigger sites; this
// reconciles anything those sites missed and returns the current checklist.
export async function GET() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await reconcileTasks(session.user.id);
  if (!status) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(status);
}

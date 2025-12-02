import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { agents } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export async function PATCH(request: Request) {
  try {
    const { agentId, score, totalRequests, successfulExploits, portDiscovered, vulnerabilitiesFound } =
      await request.json()

    const [updatedAgent] = await db
      .update(agents)
      .set({
        score,
        totalRequests,
        successfulExploits,
        portDiscovered,
        vulnerabilitiesFound,
      })
      .where(eq(agents.id, agentId))
      .returning()

    return NextResponse.json({ agent: updatedAgent })
  } catch (error) {
    console.error("Error updating agent:", error)
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 })
  }
}

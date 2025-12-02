import { NextResponse } from "next/server"

// Tower API endpoint that LLMs can discover and attack
export async function GET() {
  return NextResponse.json({
    status: "active",
    message: "Tower is operational",
    ports: [3000, 8080, 9000],
    hint: "Try POST requests with payloads",
  })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  return NextResponse.json({
    hit: true,
    damage: Math.floor(Math.random() * 10) + 5,
    message: "Direct hit on tower!",
    payload: body,
  })
}

export async function DELETE() {
  return NextResponse.json({
    critical: true,
    damage: 20,
    message: "Critical system breach!",
  })
}

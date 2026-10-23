import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { searchTickets } from '@/server/queries/tickets';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ hits: [] }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q') ?? '';
  const store = getStore();
  const hits = searchTickets(store, user, q, 8);

  return NextResponse.json({ hits });
}

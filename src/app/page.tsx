import { redirect } from 'next/navigation';
import { getSessionUser, homeFor } from '@/server/auth/session';

export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }
  redirect(homeFor(user.role));
}

import { Chat } from '@/components/chat';
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';

type ChatIndexPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Page({ searchParams }: ChatIndexPageProps) {
  const resetKey = typeof searchParams?.new === 'string' ? searchParams.new : undefined;

  if (!resetKey) {
    const freshKey = randomUUID();
    redirect(`/?new=${freshKey}`);
  }

  return <Chat key={resetKey} />;
}

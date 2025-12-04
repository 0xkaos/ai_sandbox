import { Chat } from '@/components/chat';

type ChatIndexPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Page({ searchParams }: ChatIndexPageProps) {
  const resetKey = typeof searchParams?.new === 'string' ? searchParams.new : undefined;
  return <Chat key={resetKey ?? 'root-chat'} />;
}

import { Chat } from '@/components/chat';

type ChatIndexPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: ChatIndexPageProps) {
  const params = await searchParams;
  const resetKey = typeof params?.new === 'string' ? params.new : undefined;
  return <Chat key={resetKey ?? 'root-chat'} />;
}

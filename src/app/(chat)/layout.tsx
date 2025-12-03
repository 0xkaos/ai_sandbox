export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar will go here */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}

export default function BoardLayout({ children }: {
    children: React.ReactNode;
}) { return <main className="h-dvh overflow-hidden bg-background text-foreground">{children}</main>; }

export default function BoardLayout({ children }: {
    children: React.ReactNode;
}) { return <main className="sky-surface h-dvh overflow-hidden bg-background text-foreground">{children}</main>; }

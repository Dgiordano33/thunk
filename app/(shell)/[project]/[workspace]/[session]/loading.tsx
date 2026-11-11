export default function Loading() {
  return <div role="status" aria-label="Loading workspace" className="h-full">
    <div className="h-10 border-b px-3" />
    <div className="mx-auto max-w-3xl space-y-4 p-6 animate-pulse">
      <div className="bg-muted h-4 w-2/3 rounded" />
      <div className="bg-muted h-24 rounded-lg" />
      <div className="bg-muted h-4 w-1/2 rounded" />
    </div>
  </div>;
}

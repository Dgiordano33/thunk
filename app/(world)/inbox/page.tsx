import { Inbox } from "@/components/inbox/inbox";
import { loadSidebarProjects } from "@/components/layout/sidebar-tree";
export const metadata = { title: "Inbox · Thunk" };
export const dynamic = "force-dynamic";
export default async function InboxPage() {
  return <Inbox projects={await loadSidebarProjects()} />;
}

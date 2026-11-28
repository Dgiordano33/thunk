import { PlanChangePage } from "@/components/inbox/plan-change";

export const metadata = { title: "Plan changed · Thunk" };
export const dynamic = "force-dynamic";

export default async function PlanChangeRoute(props: PageProps<"/inbox/plan-changes/[id]">) {
  const { id } = await props.params;
  return <PlanChangePage changeId={id} />;
}

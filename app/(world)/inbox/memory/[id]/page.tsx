import { ProposalPage } from "@/components/memory/proposal-page";

export const metadata = { title: "Memory update · Thunk" };
export const dynamic = "force-dynamic";

export default async function MemoryProposalPage(props: PageProps<"/inbox/memory/[id]">) {
  const { id } = await props.params;
  return <ProposalPage proposalId={id} />;
}

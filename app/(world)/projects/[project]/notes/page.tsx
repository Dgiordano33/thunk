import { TownPage } from "@/components/town/town-page";
export { generateMetadata } from "../../../[project]/page";
export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/projects/[project]/notes">) {
  const query = await props.searchParams;
  return <TownPage params={props.params} searchParams={Promise.resolve({ ...query, ws: undefined, session: undefined, building: "library" })} />;
}

import { Undiscovered } from "@/components/world/undiscovered";

export const metadata = { title: "Notes · Thunk" };

export default function NotesPage() {
  return (
    <Undiscovered title="Notes" icon="scroll">
      A scroll for everything you learn along the way: notes that live beside your projects and travel with every session.
    </Undiscovered>
  );
}

import { Suspense } from "react";
import { NotesLibrary } from "@/components/notes/notes-library";

export const metadata = { title: "Library · Thunk" };

export default function NotesPage() {
  return (
    <Suspense>
      <NotesLibrary />
    </Suspense>
  );
}

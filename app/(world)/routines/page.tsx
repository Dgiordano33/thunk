import { Undiscovered } from "@/components/world/undiscovered";

export const metadata = { title: "Routines · Thunk" };

export default function RoutinesPage() {
  return (
    <Undiscovered title="Routines" icon="hourglass">
      Standing orders for your agents: recurring sessions that run on a schedule and report back to the city that owns them.
    </Undiscovered>
  );
}

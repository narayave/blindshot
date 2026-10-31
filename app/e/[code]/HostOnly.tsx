import { setLook } from "@/app/admin/actions";
import { LOOK_NAMES } from "@/lib/config";

// Only the host reaches an offline event (openEvent), so say so: otherwise it looks like the switch didn't work.
// Offline events are the host's own test benches, so they also get a picker for the film look.
export default function HostOnly({ eventId, look }: { eventId: string; look: string | null }) {
  return (
    <div className="host-only" role="status">
      <p>This event is <b>OFF</b>. Only you (the host) can see this page; guests get a 404. <a href="/e/admin">Switch it on →</a></p>
      <form className="look-pick">
        <span>Film look:</span>
        {[null, ...LOOK_NAMES].map((l) => (
          <button key={l ?? "default"} formAction={setLook.bind(null, eventId, l)} aria-pressed={look === l}>{l ?? "default"}</button>
        ))}
      </form>
    </div>
  );
}

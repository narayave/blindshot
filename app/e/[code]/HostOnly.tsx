// Only the host reaches an offline event (openEvent), so say so: otherwise it looks like the switch didn't work.
export default function HostOnly() {
  return (
    <p className="host-only" role="status">
      This event is <b>OFF</b>. Only you (the host) can see this page; guests get a 404. <a href="/e/admin">Switch it on →</a>
    </p>
  );
}

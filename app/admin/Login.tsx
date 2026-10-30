"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function Login({ next = "/admin" }: { next?: string }) {
  const [err, action, pending] = useActionState(login, "");
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <label className="field" htmlFor="password">Host password
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </label>
      <p className="err" role="alert">{err}</p>
      <button className="cta" type="submit" disabled={pending}><span>Open the darkroom</span><span aria-hidden>→</span></button>
    </form>
  );
}

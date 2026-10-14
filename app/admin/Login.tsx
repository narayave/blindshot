"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function Login() {
  const [err, action, pending] = useActionState(login, "");
  return (
    <form action={action}>
      <label className="field" htmlFor="password">Host password
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </label>
      <p className="err" role="alert">{err}</p>
      <button className="cta" type="submit" disabled={pending}><span>Open the darkroom</span><span aria-hidden>→</span></button>
    </form>
  );
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { adminLogin, isAdmin } from "@/lib/session";

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

export async function login(_: string, form: FormData): Promise<string> {
  const next = String(form.get("next") ?? "");
  if (await adminLogin(String(form.get("password") ?? ""))) redirect(next.startsWith("/admin") || next === "/e/admin" ? next : "/admin");
  return "That password isn't right.";
}

export async function toggle(photoId: string, field: "starred" | "hidden") {
  await guard();
  if (field === "starred") await sql`update photos set starred = not starred where id = ${photoId}`;
  else await sql`update photos set hidden = not hidden where id = ${photoId}`;
  revalidatePath("/admin");
}

export async function setOnline(eventId: string, on: boolean) {
  await guard();
  await sql`update events set online = ${on} where id = ${eventId}`;
  revalidatePath("/admin", "layout");
  revalidatePath("/e/admin");
}

export async function setRelease(eventId: string, when: "now" | "hold") {
  await guard();
  await sql`update events set release_at = ${when === "now" ? sql`now()` : null} where id = ${eventId}`;
  revalidatePath("/admin", "layout"); // the darkroom
  revalidatePath("/e/admin"); // the events page
}

// Back in the queue: the worker develops it again.
export async function reprocess(photoId: string) {
  await guard();
  await sql`update photos set status = 'uploaded', processed_at = null, attempts = 0 where id = ${photoId} and status <> 'pending'`;
  revalidatePath("/admin");
}

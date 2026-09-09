"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createCompany(formData: FormData) {
  const name = (formData.get("name") as string | null)?.trim();
  if (!name) {
    return { error: "Company name is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated." };
  }

  // RLS ("platform admin full access to companies") enforces that only a
  // platform admin can actually insert here — this isn't a trust boundary
  // we're re-implementing in app code, Postgres itself rejects it otherwise.
  const { error } = await supabase.from("companies").insert({
    name,
    created_by: user.id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/platform");
  return { error: null };
}

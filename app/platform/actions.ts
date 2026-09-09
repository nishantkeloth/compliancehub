"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import crypto from "crypto";

function randomTempPassword() {
  // 12 chars, mixed — one-time password the admin must change on first
  // login (must_change_password enforces that once the app checks it).
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x") + "!1";
}

export async function createCompany(formData: FormData) {
  const companyName = (formData.get("companyName") as string | null)?.trim();
  const adminName = (formData.get("adminName") as string | null)?.trim() || null;
  const adminEmail = (formData.get("adminEmail") as string | null)?.trim() || null;

  if (!companyName) {
    return { error: "Company name is required." };
  }
  if (adminEmail && !adminName) {
    return { error: "Admin name is required if you're onboarding an admin." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated." };
  }

  // Explicit authorization check — everything below uses the service-role
  // client, which bypasses RLS entirely, so this check IS the security
  // boundary for this action (not the database).
  const { data: platformAdminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!platformAdminRow) {
    return { error: "Only a platform admin can do this." };
  }

  const admin = createAdminClient();

  const { data: company, error: companyError } = await admin
    .from("companies")
    .insert({ name: companyName, created_by: user.id })
    .select("id, name")
    .single();
  if (companyError || !company) {
    return { error: companyError?.message ?? "Could not create company." };
  }

  await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    org_id: company.id,
    action: "company.create",
    target_type: "company",
    target_id: company.id,
    details: { name: companyName },
  });

  if (!adminEmail) {
    revalidatePath("/platform");
    return { error: null, company };
  }

  // Also onboard the first Company Admin for this new company — same
  // admin-direct pattern the design spec settled on for inviting anyone:
  // create the login now, hand back a one-time temp password to relay.
  const tempPassword = randomTempPassword();
  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: adminName },
  });
  if (createUserError || !created?.user) {
    return {
      error: `Company created, but the admin account could not be created: ${createUserError?.message ?? "unknown error"}`,
      company,
    };
  }

  const newUserId = created.user.id;

  // handle_new_user() already inserted a blank profile row for this new
  // auth user — fill in org/role now. Must go through the service-role
  // client: the guard trigger on profiles blocks role/org_id/status
  // changes from any non-admin session, and a platform admin's own
  // org_id is null, so the normal "update profiles in their company"
  // RLS policy wouldn't match here anyway.
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      org_id: company.id,
      role: "company_admin",
      must_change_password: true,
      full_name: adminName,
    })
    .eq("id", newUserId);
  if (profileError) {
    return {
      error: `Company and admin login created, but linking the admin to the company failed: ${profileError.message}`,
      company,
    };
  }

  await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    org_id: company.id,
    action: "user.create_direct",
    target_type: "user",
    target_id: newUserId,
    details: { email: adminEmail, role: "company_admin" },
  });

  revalidatePath("/platform");
  return {
    error: null,
    company,
    admin: { email: adminEmail, tempPassword },
  };
}

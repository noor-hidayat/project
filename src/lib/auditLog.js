import { supabase } from "./supabaseClient";

export async function addAuditLog({ username, action, detail }) {
  if (!supabase) return;
  try {
    await supabase.from("audit_logs").insert({
      username: username || null,
      action: action || "unknown",
      detail: detail || null,
    });
  } catch {
    // logging tidak boleh memblokir alur utama aplikasi
  }
}

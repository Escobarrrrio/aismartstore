import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { resolve } from "path";

const envContent = fs.readFileSync(resolve(process.cwd(), ".env"), "utf-8");
const envVars = Object.fromEntries(
  envContent.split("\n").filter(line => line && !line.trim().startsWith("#")).map(line => {
    const [key, ...rest] = line.split("=");
    return [key.trim(), rest.join("=").replace(/^["'\s]+|["'\s]+$/g, '')];
  })
);

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseKey = envVars.VITE_SUPABASE_PUBLISHABLE_KEY; // Anon key, we might be limited by RLS

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSystemHealth() {
  console.log("=== SYSTEM HEALTH & ERROR TRACE ===");

  // 1. Check if auth works (try to sign up a dummy user just to see what error we get, then delete it or let it fail)
  const dummyEmail = `test_${Date.now()}@example.com`;
  console.log(`\n--- Testing Signup for ${dummyEmail} ---`);
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: dummyEmail,
    password: "CorrectHorseBatteryStaple2026!@#",
    options: {
      data: {
        full_name: "Test User",
        customer_type: "residential",
        phone: "+27600000000"
      }
    }
  });

  if (signUpError) {
    console.error("Signup failed:", signUpError.message);
  } else {
    console.log("Signup returned success/session:", signUpData.session ? "Yes" : "No (requires email confirm)");
  }

  // 2. Query automation events
  console.log("\n--- Recent Automation Events (Errors) ---");
  const { data: events, error: eventsError } = await supabase
    .from("automation_events")
    .select("*")
    .eq("status", "error")
    .order("created_at", { ascending: false })
    .limit(10);

  if (eventsError) {
    console.error("Could not fetch automation_events (RLS might block anon):", eventsError.message);
  } else {
    console.log(`Found ${events?.length || 0} recent errors.`);
    events?.forEach(e => console.log(`- ${e.created_at} [${e.source}/${e.event_type}]: ${e.error_message}`, e.payload));
  }

  // 3. Query email send log
  console.log("\n--- Recent Email Failures ---");
  const { data: emails, error: emailsError } = await supabase
    .from("email_send_log")
    .select("*")
    .in("status", ["failed", "dlq", "rate_limited"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (emailsError) {
    console.error("Could not fetch email_send_log (RLS might block anon):", emailsError.message);
  } else {
    console.log(`Found ${emails?.length || 0} recent email failures.`);
    emails?.forEach(e => console.log(`- ${e.created_at} [${e.template_name} to ${e.recipient_email}]: ${e.error_message}`));
  }

  // 4. Query order audit log
  console.log("\n--- Recent Order Price Reconciliations ---");
  const { data: audits, error: auditsError } = await supabase
    .from("order_audit_log")
    .select("*")
    .eq("event_type", "price.reconciled")
    .order("created_at", { ascending: false })
    .limit(5);

  if (auditsError) {
    console.error("Could not fetch order_audit_log (RLS might block anon):", auditsError.message);
  } else {
    console.log(`Found ${audits?.length || 0} price reconciliation events.`);
    audits?.forEach(a => console.log(`- ${a.created_at} [Order ${a.order_id}]:`, a.metadata));
  }
}

checkSystemHealth().catch(console.error);

import { useState } from "react";
import { Mail } from "lucide-react";

/**
 * In-browser preview of every branded email template. These are faithful
 * HTML replicas of the JSX templates that live in
 * supabase/functions/_shared/email-templates and the notify-order function.
 * They render inside iframes so their own <style> and inline styles are
 * isolated from the admin shell.
 */

const SITE = "AI Smart Store";
const URL_SAMPLE = "https://aismartstore.co.za/verify?token=demo";
const OTP = "482913";

const BRAND_HEAD = `
<style>
  body { margin:0; background:#ffffff; }
  .container { padding:32px 28px; max-width:560px; font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; }
  h1 { font-family:Outfit,-apple-system,sans-serif; font-size:26px; font-weight:700; color:hsl(222,47%,11%); letter-spacing:-0.02em; margin:0 0 20px; }
  p  { font-size:15px; color:hsl(220,9%,38%); line-height:1.6; margin:0 0 20px; }
  .btn { background-image:linear-gradient(135deg,#06b6d4 0%,#7c3aed 50%,#d946ef 100%); background-color:#7c3aed; color:#fff !important; font-weight:600; border-radius:999px; padding:14px 32px; text-decoration:none; display:inline-block; font-size:15px; }
  .footer { font-size:12px; color:hsl(220,9%,55%); margin:32px 0 0; border-top:1px solid hsl(220,13%,91%); padding-top:20px; }
  .otp { font-family:'JetBrains Mono',monospace; font-size:32px; letter-spacing:8px; font-weight:700; color:hsl(222,47%,11%); background:hsl(220,14%,96%); border-radius:12px; padding:20px; text-align:center; margin:24px 0; }
  table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
  th, td { padding:8px 0; text-align:left; color:hsl(222,47%,11%); }
  th { color:hsl(220,9%,55%); border-bottom:1px solid hsl(220,13%,91%); font-weight:600; }
</style>`;

const wrap = (body: string) => `<!doctype html><html><head>${BRAND_HEAD}</head><body><div class="container">${body}</div></body></html>`;

const templates: { id: string; label: string; html: string }[] = [
  {
    id: "signup",
    label: "Signup confirmation",
    html: wrap(`<h1>Confirm your email</h1><p>Welcome to ${SITE}! Please confirm your email address to activate your account.</p><p><a class="btn" href="${URL_SAMPLE}">Confirm email</a></p><p class="footer">If you didn't sign up, ignore this email.</p>`),
  },
  {
    id: "recovery",
    label: "Password reset",
    html: wrap(`<h1>Reset your password</h1><p>We received a request to reset your password for ${SITE}. Click the button below to choose a new password.</p><p><a class="btn" href="${URL_SAMPLE}">Reset password</a></p><p class="footer">If you didn't request a password reset, you can safely ignore this email.</p>`),
  },
  {
    id: "magic-link",
    label: "Magic link",
    html: wrap(`<h1>Your sign-in link</h1><p>Click the button below to sign in to ${SITE}. This link expires in 60 minutes.</p><p><a class="btn" href="${URL_SAMPLE}">Sign in</a></p><p class="footer">Didn't request this? You can ignore this email.</p>`),
  },
  {
    id: "invite",
    label: "Team invite",
    html: wrap(`<h1>You're invited</h1><p>You've been invited to join ${SITE}. Accept the invitation to set up your account.</p><p><a class="btn" href="${URL_SAMPLE}">Accept invite</a></p><p class="footer">Invitation expires in 7 days.</p>`),
  },
  {
    id: "email-change",
    label: "Email change confirmation",
    html: wrap(`<h1>Confirm your new email</h1><p>Confirm this address as the new email for your ${SITE} account.</p><p><a class="btn" href="${URL_SAMPLE}">Confirm new email</a></p><p class="footer">If you didn't request this change, contact support immediately.</p>`),
  },
  {
    id: "reauthentication",
    label: "Reauthentication code",
    html: wrap(`<h1>Verification code</h1><p>Use this one-time code to complete a sensitive action on ${SITE}. Do not share it.</p><div class="otp">${OTP}</div><p class="footer">This code expires in 10 minutes.</p>`),
  },
  {
    id: "order-owner",
    label: "Order — owner notification",
    html: wrap(`<h1>New order placed</h1><p>Order <strong>#ORD-2839</strong></p><table><tr><th>Customer</th><td>Jane Ndlovu</td></tr><tr><th>Email</th><td>jane@example.com</td></tr><tr><th>Total</th><td>R 12 480.00</td></tr><tr><th>Address</th><td>27 Long St, Cape Town, 8001</td></tr></table><table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th></tr></thead><tbody><tr><td>NVIDIA Jetson Orin Nano</td><td style="text-align:right">1</td><td style="text-align:right">R 9 999</td></tr><tr><td>USB-C Hub</td><td style="text-align:right">3</td><td style="text-align:right">R 827</td></tr></tbody></table>`),
  },
  {
    id: "order-customer",
    label: "Order — customer confirmation",
    html: wrap(`<h1>Thank you for your order, Jane</h1><p>We've received your order <strong>#ORD-2839</strong> and will email you again once it ships.</p><table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th></tr></thead><tbody><tr><td>NVIDIA Jetson Orin Nano</td><td style="text-align:right">1</td><td style="text-align:right">R 9 999</td></tr><tr><td>USB-C Hub</td><td style="text-align:right">3</td><td style="text-align:right">R 827</td></tr></tbody></table><p style="font-size:18px;color:hsl(222,47%,11%)"><strong>Total: R 12 480.00</strong></p><p class="footer">Questions? Just reply to this email.</p>`),
  },
];

const EmailPreviewsModule = () => {
  const [selected, setSelected] = useState(templates[0].id);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const tpl = templates.find((t) => t.id === selected)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="h-4 w-4" />
        Preview every branded email your customers and team receive.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <div className="bg-card border border-border rounded-xl p-2 h-fit">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-display font-semibold transition ${
                selected === t.id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
            <p className="text-xs font-display font-bold">{tpl.label}</p>
            <div className="flex gap-1 text-[11px]">
              <button
                onClick={() => setViewport("desktop")}
                className={`px-2 py-1 rounded ${viewport === "desktop" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >Desktop</button>
              <button
                onClick={() => setViewport("mobile")}
                className={`px-2 py-1 rounded ${viewport === "mobile" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >Mobile</button>
            </div>
          </div>
          <div className="p-6 bg-gradient-to-br from-muted/40 to-muted/10 flex justify-center">
            <iframe
              key={tpl.id + viewport}
              title={tpl.label}
              srcDoc={tpl.html}
              className="bg-white rounded-lg shadow-elevated border border-border transition-all"
              style={{ width: viewport === "desktop" ? 640 : 380, height: 620 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailPreviewsModule;

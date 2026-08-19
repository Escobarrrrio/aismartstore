# Consent-First Controls & Badge Removal

## Goal
Confirm and enforce a consent-based workflow for this project, remove the Lovable "Edit with Lovable" badge from the published site, and verify that hosting remains independent (Vercel).

## What we will do

1. **Hide the "Edit with Lovable" badge**
   - Use the publish settings tool to set badge visibility to hidden.
   - This is only possible because the project is on a paid plan.
   - No source files need to change for this.

2. **Confirm consent-based coding policy**
   - Going forward, any code or database change that is not explicitly requested will be surfaced for approval first.
   - Database migrations, schema changes, or data exports will only happen after explicit written consent.

3. **Verify independent hosting status**
   - Confirm the published domain is using Vercel / custom-domain routing as expected.
   - Ensure no Lovable-managed hosting takeover is in progress.

## What we will NOT do

- Migrate, copy, or move the Supabase database without explicit written consent.
- Add Lovable branding that cannot be removed.
- Change hosting configuration unless explicitly asked.

## Out of scope

- Self-hosting migration (already on Vercel).
- Database credential exposure or export (not requested and not done without consent).

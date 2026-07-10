
-- 1) ticket_messages: enforce ticket ownership + is_admin flag safety
DROP POLICY IF EXISTS "Authenticated users can create messages" ON public.ticket_messages;

CREATE POLICY "Ticket owner or admin can create messages"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND t.user_id = auth.uid()
    )
  )
  AND (
    public.has_role(auth.uid(), 'admin')
    OR COALESCE(is_admin, false) = false
  )
);

-- 2) Revoke GraphQL/table discoverability for internal-only tables.
-- RLS already blocks non-admin reads; also removing table-level grants
-- hides them from the GraphQL schema.
REVOKE SELECT ON public.sync_logs FROM anon, authenticated;
REVOKE SELECT ON public.automation_events FROM anon, authenticated;
REVOKE SELECT ON public.newsletter_campaigns FROM anon, authenticated;
REVOKE SELECT ON public.product_costs FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;
REVOKE SELECT ON public.order_audit_log FROM anon;
REVOKE SELECT ON public.store_settings FROM anon;

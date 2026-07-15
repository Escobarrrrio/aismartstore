REVOKE EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compliance_pack(uuid, text) TO authenticated, service_role;
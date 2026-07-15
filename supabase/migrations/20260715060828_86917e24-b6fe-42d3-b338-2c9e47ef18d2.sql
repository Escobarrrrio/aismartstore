CREATE OR REPLACE FUNCTION public.recategorize_batch(batch_size integer DEFAULT 3000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  updated_count int;
BEGIN
  WITH batch AS (
    SELECT id FROM public.products
    WHERE is_active = true AND (category IS NULL OR lower(category) = 'accessories')
    LIMIT batch_size
  )
  UPDATE public.products p SET category = CASE
    WHEN p.name ~* '(SVC$|\mFC[0-9]Y\M|NBDExch|NBD Exch|Foundation Care|Care Pack|Warranty|Warr\.)' THEN 'Support & Warranty'
    WHEN p.name ~* '(License|Licence|Subscription|SaaS|Monthly Payment|Per User|Add.On|Office 365|Microsoft 365|Azure|Windows Server)' THEN 'Software & Licensing'
    WHEN p.name ~* '(Cable|Cbl|Pwr Cord|Power Cord|Patch Cord|Fiber Patch)' THEN 'Cables'
    WHEN p.name ~* '(Toner|Ink Cart|Cartridge|Drum|Fuser)' THEN 'Printer Consumables'
    WHEN p.name ~* '(Switch|Router|Firewall|Access Point|WAP|WiFi|Wireless)' THEN 'Networking'
    WHEN p.name ~* '(Server|Rack|UPS|PDU|Chassis|Blade)' THEN 'Servers & Data Centre'
    WHEN p.name ~* '(Laptop|Notebook|ProBook|EliteBook|ThinkPad|Latitude|Precision)' THEN 'Laptops'
    WHEN p.name ~* '(Desktop|Workstation|Tower|OptiPlex|MiniPC|NUC|Micro PC)' THEN 'Desktops & Workstations'
    WHEN p.name ~* '(Monitor|Display|Screen|LED|LCD)' THEN 'Monitors & Displays'
    WHEN p.name ~* '(Keyboard|Mouse|Headset|Webcam|Docking|Dock )' THEN 'Peripherals'
    WHEN p.name ~* '(SSD|HDD|Hard Drive|Solid State|NVMe|Storage|SAN|NAS)' THEN 'Storage'
    WHEN p.name ~* '(RAM|Memory|DIMM|SODIMM|DDR)' THEN 'Memory'
    WHEN p.name ~* '(GPU|Graphics Card|Quadro|RTX|GeForce|Radeon|Tesla|A100|H100)' THEN 'GPUs & AI Accelerators'
    WHEN p.name ~* '(Printer|MFP|Multifunction|Scanner)' THEN 'Printers & Scanners'
    WHEN p.name ~* '(Camera|CCTV|Surveillance|IP Cam)' THEN 'Security & Surveillance'
    ELSE 'Accessories (General)'
  END
  FROM batch WHERE p.id = batch.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recategorize_batch(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recategorize_batch(integer) TO authenticated, service_role;
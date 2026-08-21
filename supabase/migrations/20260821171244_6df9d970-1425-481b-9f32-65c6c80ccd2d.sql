delete from public.order_email_queue where order_id = '08c1f437-2d78-4126-a875-0fcd3992a299';
delete from public.order_items where order_id = '08c1f437-2d78-4126-a875-0fcd3992a299';
delete from public.order_audit_log where order_id = '08c1f437-2d78-4126-a875-0fcd3992a299';
delete from public.orders where id = '08c1f437-2d78-4126-a875-0fcd3992a299';
delete from public.email_send_log where recipient_email like 'smoke+%@aismartstore.co.za';
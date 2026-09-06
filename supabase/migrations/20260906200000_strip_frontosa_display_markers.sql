-- Frontosa bakes their own display markers straight into `desc`: a leading
-- "!!" on 2130 of their 6365 products, a leading "*" on another 861 -- 47% of
-- their whole catalogue. frontosa-sync wrote that straight through as the
-- product name with no cleanup, so it showed up verbatim on the storefront
-- ("!!Amd G34 6128 2G 8xcore -no f" as the product title), and then again
-- inside the generated "About this product" paragraph, which quotes the name
-- directly. Only 117 of the affected rows were active/visible at the time
-- this was found, but the pipeline that stores Frontosa's imageless stock
-- (added earlier today) means that number rises every time a photo gets
-- attached, so this is fixed at the data now rather than left to surface one
-- row at a time.
--
-- Safe to strip outright rather than translate into a customer-facing badge:
-- item.status is already captured separately as specifications.supplier_status
-- and deliberately hidden from the spec table, so whatever "!!" vs "*" signals
-- on Frontosa's own site is not information this store is otherwise missing.
-- Their exact meaning was never confirmed against Frontosa's documentation,
-- which is exactly why this drops the character rather than inventing a
-- "Clearance"/"Hot Deal" label for it.
--
-- classify_product_category/classify_product_audience re-run on this UPDATE
-- (BEFORE UPDATE OF name), which is fine -- the leading punctuation could not
-- have mattered to those word-boundary regexes, but re-deriving costs nothing
-- and there is no reason to special-case around the trigger.
UPDATE public.products
   SET name = regexp_replace(name, '^(?:!{2,}|\*)\s*', ''),
       description = CASE
         WHEN description IS NOT NULL
           THEN regexp_replace(description, '^(?:!{2,}|\*)\s*', '')
         ELSE description
       END
 WHERE sku LIKE 'FR-%'
   AND (name ~ '^(?:!{2,}|\*)' OR description ~ '^(?:!{2,}|\*)');

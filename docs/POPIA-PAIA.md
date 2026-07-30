# POPIA & PAIA Compliance — AI Smart Store

AI Smart Store (a South African e-commerce platform) is committed to full
compliance with:

- **POPIA** — Protection of Personal Information Act, 4 of 2013
- **PAIA** — Promotion of Access to Information Act, 2 of 2000

This document is the operational reference for the compliance posture that
is presented publicly at `/compliance`.

## 1. Responsible Party & Information Officer

| Field | Value |
| --- | --- |
| Responsible Party | AI Smart Store |
| Information Officer | Fernando Steyn |
| Contact | privacy@aismartstore.co.za |
| Jurisdiction | Republic of South Africa |
| Regulator | Information Regulator of South Africa (https://inforegulator.org.za) |

## 2. Personal information processed

| Category | Purpose | Retention |
| --- | --- | --- |
| Name, email, phone | Order fulfilment, transactional email | 7 years (tax) |
| Shipping address | Delivery | 7 years (tax) |
| Order history | Customer account, warranty, returns | 7 years (tax) |
| Newsletter opt-in | Marketing (with explicit consent) | Until unsubscribe |
| Payment confirmation | Reconciliation | 7 years (tax) |
| Support tickets | Customer service | 3 years |

We do **not** store card PANs or CVV — these are handled by Yoco / PayPal
as PCI-DSS certified processors.

## 3. Lawful basis (POPIA s.11)

- **Contract**: order fulfilment
- **Legal obligation**: SARS invoice retention
- **Consent**: newsletter marketing
- **Legitimate interest**: fraud detection, security audit logs

## 4. Security safeguards (POPIA s.19)

- TLS 1.3 in transit
- Postgres RLS on every table — customers can only read their own rows
- Role-based access control (`user_roles.role`) enforced by security-definer functions
- Admin secrets held in Supabase Vault, never in the client bundle
- Nightly database backups (see `BackupsModule`)
- Audit trail in `sync_logs` and `automation_events`

## 5. Data-subject rights procedure

Requests are received at `privacy@aismartstore.co.za`. Turnaround:

| Right | POPIA s. | Turnaround |
| --- | --- | --- |
| Access | s.23 | 30 days |
| Correction | s.24 | 30 days |
| Deletion | s.24(1)(c) | 30 days |
| Object to marketing | s.11(3) | Immediate (unsubscribe link) |

## 6. Cross-border transfer (POPIA s.72)

Data hosted in Supabase (EU/US). Adequacy relied upon: contractual
safeguards in Supabase DPA, which mirrors GDPR SCCs and is acceptable
under POPIA s.72(1)(a).

## 7. PAIA Manual (s.51)

A PAIA Manual is available on request from the Information Officer. It
describes the records held and the Form 2 procedure for access requests.

---

_Last reviewed: {{ update on each policy change }}._

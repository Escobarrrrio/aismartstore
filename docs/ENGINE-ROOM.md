# The Engine Room

**Admin → System → Engine Room**

This is the screen that answers one question before any other: *is anything about
to cost me money I did not agree to.*

The rest of the admin tells you what already happened. This part can stop things.

---

## Why it exists

Everything automated in this store runs on somebody else's meter — SMS through
Telnyx, AI through a gateway, email through Resend. Every one of those turns an
HTTP request into a charge. The dangerous property is that the charge happens
whether or not the request was legitimate, and whether or not anyone is awake.

Before this, the store recorded that spend accurately and could not do a single
thing about it. `ai_usage_log`'s own header says so: the budget cap the admin
displayed had *"no enforcement anywhere in the codebase"*.

---

## The three ceilings

### 1. Rate limits

Per caller, per action. The SMS sender allows 5 sends from one address then one
every two minutes. The customer AI chat allows 12 messages then one a minute per
account.

These slow one person down. They do not bound the total, because an attacker
does not use one account — they make more.

### 2. Spend caps

**This is the one that actually protects you.** Per provider, per day and per
month, in rand, checked immediately *before* each billable call. When today's
cap is reached, the calls stop. Not "get logged" — stop.

| Provider | Daily | Monthly | Why this number |
|---|---|---|---|
| Telnyx SMS (OTP) | R60 | R700 | ~250 messages. Far above a real day's signups, far below anything that matters if it all goes to an attacker. This is the tightest cap on the store because SMS is the only thing here that turns an *unauthenticated* request straight into a charge. |
| AI gateway | R40 | R600 | Customer chat, the admin agent, and the Engine Room's own watch share this. |
| OpenAI | R40 | R600 | Same, when OpenAI is the configured provider. |
| Transactional email | R30 | R400 | Order confirmations, digests, alerts. |
| Axiz, Courier Guy, FX | — | — | Metered by call count rather than rand; these do not bill per request. |

The day resets at midnight **South African time**, not UTC. A UTC reset would
hand an attacker two fresh daily budgets inside one South African night.

### 3. Security log

Every refusal, every anomaly, every cap change, in a table that **nobody can
edit or delete** — not you, not an admin session, not anything holding your
password. An audit log the suspect can edit is a diary, not evidence.

---

## The caps apply to you as well

This is deliberate, and it is worth being clear about because it will
occasionally be annoying.

- The admin AI agent is checked against the same daily ceiling as an anonymous
  customer's chat message. There is **no admin bypass**, anywhere, on purpose —
  a bypass switch is the first thing somebody with a stolen admin session
  reaches for.
- You can lower any cap freely from the Engine Room.
- You can raise a cap **up to a hard ceiling written into the database schema**.
  Past that, it takes a code change: a commit, a review, a deploy. So a tired
  person at 2am cannot turn R60/day into R50 000/day with one click, and neither
  can anyone wearing that person's session.
- Every cap change is logged with the old and new values and who made it.
  Loosening one is logged at **high** severity even when it is completely
  legitimate.

---

## Bots, spam and phishing

Two forms on this site can be filled in by anybody: the newsletter signup and
the business quote form. Both post **straight to the database**, not through any
server code — which is why the defence lives in the database too. There is no
way to reach those tables that skips it.

Every submission is scored 0–100 against 26 patterns covering phishing
(credential-harvest language, link shorteners, raw-IP URLs, punycode,
mixed-script lookalike domains), spam (link stuffing, SEO pitches, pharma,
gambling, crypto), and injection (SQL and script payloads). Zero-width
characters and padded whitespace are stripped first, so `v‍iagra` is caught the
same as `viagra`.

| Score | What happens |
|---|---|
| under 40 | Goes through. Nothing recorded. Ordinary traffic. |
| 40–69 | Goes through, but recorded. You can see it building in the Engine Room. Nobody is turned away on a maybe. |
| 70+ | **Quarantined.** The submission is kept whole and shown to you, the sender is blocked, and the sender is told nothing. |

**Quarantined, not rejected — and that's deliberate.** The sender sees the
normal "thank you" screen. A spammer who sees an error learns which words trip
the scorer and edits until they get through; one who sees success learns
nothing. And if the scorer got it *wrong*, the enquiry isn't gone — it's sitting
in the Engine Room where you can read it.

Blocks double each time: 1 hour, then 2, 4, 8… capped at a week. Three blocked
senders on one company domain blocks the whole domain — except free providers,
because blocking gmail.com would take your customers with it. **Anyone who has
actually paid you is never auto-blocked on wording.** A regex is not better
evidence than a completed order.

### If you think it caught someone real

Open **Admin → Engine Room → Bots, spam and phishing**. Quarantined submissions
are listed in full, with which patterns matched. Press **Unblock** next to the
sender and ask them to resend. Every unblock is logged.

The watch raises a notice whenever *anything* is in quarantine, precisely
because a quarantined enquiry is otherwise invisible — the sender was told
nothing, and nothing else in the system mentions it.

---

## The watch

Every three hours, `engine-room-analyst` reads the room, grades it, and emails
you if it matters. You can also press **Run check now**.

**The grade is decided by rules, not by the AI.** The AI writes the paragraph
that explains the grade in plain language — and only when there is something to
explain.

That split matters. An AI-judged monitor stops judging exactly when the AI
budget runs out, which on this store is a *symptom* of the thing being watched.
A watchman that goes quiet when the alarm is loudest is worse than no watchman,
because the silence reads as an all-clear. So the alert fires with or without
the AI, and the screen tells you which half wrote which part.

### What each grade means

| Grade | Emails you? | What it means |
|---|---|---|
| **critical** | Yes | A critical engine has stopped or failed, a spend cap is exhausted, or five or more high-severity refusals in 24 hours. Look now. |
| **warning** | Yes | A non-critical engine has stopped, an engine had a partial run, a cap is past 80%, or a cap is switched off entirely. Look today. |
| **notice** | No | An engine has never run (normal right after a deploy), hard stop is off on a cap, someone edited a cap, or something is sitting in quarantine. Worth knowing, not worth waking up for. |
| **ok** | No | Nothing to do. |

Alerts repeat at most once every 6 hours. Six identical emails a day trains you
to archive on sight — and then the seventh, about something worse, gets archived
too.

### "Stalled" is the one to care about

An engine that fails loudly is already in the logs and already visible on four
other screens. An engine that **stopped running** produces no errors at all —
there is nothing to display, so nothing displays it.

`engine_registry` records how long each engine is allowed to be silent before
that silence is a fault. Axiz catalogue sync runs every 15 minutes and is given
45; if it goes quiet past that, the storefront is quoting yesterday's prices and
you get told.

---

## If you get an alert

1. **Open Admin → Engine Room.** The verdict is at the top; the live numbers are
   below it. If the verdict looks stale, press *Run check now*.
2. **If a spend cap is exhausted** — check the Security section for what was
   consuming it. If it was real traffic, raise the cap (within the ceiling). If
   it was not, leave the cap exactly where it is: it is doing its job.
3. **If an engine is stalled** — the engine's own row names it and shows how long
   it has been quiet. Sync Logs and Edge Function Health have the run detail.
4. **If something is quarantined** — read it. Most will obviously be spam. The
   one that isn't is a customer who thinks they contacted you and is waiting.
5. **If you see `spend_cap_changed` and you did not change one** — that is the
   one finding on this screen that means somebody else is in your admin. Change
   your password first, ask questions second.

---

## What this does not do

It does not stop a legitimate-looking, correctly-authenticated, expensive
mistake made slowly. Caps bound the *rate* and the *total*; they cannot tell
intent. Nothing can.

It also does not cover PayFast or Yoco — those move customer money rather than
spend ours, and are covered separately by the payment-event audit log and the
webhook monitoring in Admin → Payment Events.

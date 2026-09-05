# Louis Email Template Library
### Every email in the pipeline, in order, in Ben's voice. One place to edit.
*Regenerated 4 Sep 2026 with E01b (personal first reply with social proof). Seed file: `louis-email-templates.csv`.*

**How this works.** Each template is a record. The drafts engine picks the template by trigger, fills the `{{variables}}` from the deal, applies the voice checker, and lands a draft in the Review Queue and the sender's Gmail Drafts. Only E01 and E12 (client-facing) and the internal system messages send themselves.

**Order of the first two touches on a direct inquiry:** E01 auto-ack within seconds (Liezel) → E01b personal reply with related clients + one matched testimonial within the hour (Ben, drafted) → E03 call scheduling if E01b didn't land a slot → E04 proposal after the call.

| ID | Name | Stage | Lane | Type | Send | Sender |
|---|---|---|---|---|---|---|
| E01 | Intake acknowledgment | Inquiry | Direct | Keynote | AUTO | Liezel |
| E01b | Personal first reply with social proof | Inquiry | Direct | Keynote | DRAFT | Ben |
| E02 | Bureau hold confirmation | Inquiry | Bureau | Keynote | DRAFT | Ben |
| E03 | Discovery call scheduling | Qualified | Direct | Keynote | DRAFT | Ben |
| E04 | Proposal and rate | Qualified | Direct | Keynote | DRAFT | Ben |
| E04b | Proposal with budget known | Qualified | Direct | Keynote | DRAFT | Ben |
| E05 | Soft check-in | Qualified | Direct | Keynote | DRAFT | Liezel |
| E06 | Hold release (forcing email) | Qualified | Direct | Keynote | DRAFT | Ben |
| E07 | First right of refusal notice | Firm Offer | Direct | Keynote | DRAFT | Ben |
| E08 | Contract details request | Closed-Won | Direct | Keynote | DRAFT | Ben |
| E09 | Invoice | Closed-Won | Direct | Keynote | DRAFT | Liezel |
| E10 | Welcome kit | Closed-Won | Direct | Keynote | DRAFT | Ben |
| E11 | Welcome kit to agent | Closed-Won | Bureau | Keynote | DRAFT | Ben |
| E12 | Questionnaire link | Pre-Event | Direct | Keynote | AUTO | Liezel |
| E13 | Questionnaire chase | Pre-Event | Direct | Keynote | DRAFT | Ben |
| E14 | Debrief scheduling | Pre-Event | Direct | Keynote | DRAFT | Ben |
| E15 | Journal promo address | Pre-Event | Direct | Keynote | DRAFT | Liezel |
| E15b | Journal follow-up | Pre-Event | Direct | Keynote | DRAFT | Ben |
| E16 | Field guide brief (internal) | Pre-Event | Any | Keynote | AUTO | Louis |
| E17 | Post-keynote alert (internal) | Delivered | Any | Keynote | AUTO | Louis |
| E18 | Thank you, deck, testimonial | Delivered | Direct | Keynote | DRAFT | Ben |
| E19 | QR follow-up | Delivered | Any | Keynote | DRAFT | Ben |
| E20 | Next year | Debriefed | Direct | Keynote | DRAFT | Ben |
| E21 | Re-engagement, timing or budget | Closed Lost | Direct | Keynote | DRAFT | Ben |
| E21b | Re-engagement, hired another speaker | Closed Lost | Direct | Keynote | DRAFT | Ben |
| E22 | Coaching intake reply | Inquiry | Direct | Coaching | DRAFT | Ben |
| E22b | Coaching diagnostic offer | Closed Lost | Direct | Coaching | DRAFT | Ben |
| E22c | Coaching session follow-up | Pre-Event | Direct | Coaching | DRAFT | Ben |
| E22d | Next track | Pre-Event | Direct | Coaching | DRAFT | Ben |
| E23 | Daily next-action digest (internal) | Any | Any | Any | AUTO | Louis |
| E24 | Worker failure (internal) | Any | Any | Any | AUTO | Louis |

---

## E01 · Intake acknowledgment
**Stage:** Inquiry · **Lane:** Direct · **Type:** Keynote · **Send:** AUTO · **From:** Liezel · **Register:** Formal
**Trigger:** Website form or inbound email creates a deal

**Subject:** Speaking Inquiry

```
Hi {{first_name}},

Thanks for reaching out about {{event_name_or_company}}. I've got your note and I'll be back to you within a couple of hours with Ben's availability for {{event_date_or_TBD}}.

Thanks,
Liezel
```

*The only client-facing auto-send in the sales lane. Goes from Liezel's inbox. 1 hour reply SLA timer starts on send.*

## E01b · Personal first reply with social proof
**Stage:** Inquiry · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Within 1 hour of E01, once the research brief and social-proof resolver have run

**Subject:** Your Event

```
Hi {{first_name}},

Thanks for thinking of me for {{event_name_or_company}}. {{industry_line}}

{{related_clients_line}}

{{testimonial_quote}}
{{testimonial_attribution}}

Here's a short reel so you can get a feel for the room: {{reel_url}}. {{event_date}} is open on my side and I've placed a soft hold.

Are you free for a short call this week to talk through what you want people walking out with? {{slot_1}} or {{slot_2}} PT?

Thanks,
Ben
```

*The social-proof resolver fills industry_line, related_clients_line (3 to 5 past clients in the same or adjacent industry, most recent first, repeat clients favored), testimonial_quote and testimonial_attribution (one testimonial matched on industry, then format, then recency). Never more than one quote. Bureau lane: sent to the agent with the same proof block. In Launch mode Opus writes the industry_line from the research brief.*

## E02 · Bureau hold confirmation
**Stage:** Inquiry · **Lane:** Bureau · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Agent email extracted into a deal; date is open

**Subject:** Hold Confirmed

```
Hey {{agent_first}},

{{event_date}} is open and I've placed a hold for {{end_client_or_bureau}}. In-person in {{region}} is typically {{list_fee}} plus travel, rate card attached.

Happy to jump on the call whenever they're ready. Liezel's cc'd for anything logistics.

Thanks,
Ben
```

*One hold per date even if the agent has several clients circling. Liezel cc'd.*

## E03 · Discovery call scheduling
**Stage:** Qualified · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Deal moves to Qualified (capacity check passed)

**Subject:** Quick Call

```
Hi {{first_name}},

I'd love to learn more about {{event_name}} and what you want the room to walk out with before we talk fees.

Are you free for a short call this week? {{slot_1}} or {{slot_2}} PT?

Adding Liezel to help lock a time.

Thanks,
Ben
```

*Ben takes every call. Two named slots, always.*

## E04 · Proposal and rate
**Stage:** Qualified · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Discovery call held (Fathom summary attached to deal)

**Subject:** Keynote Details

```
Great call today, thanks {{first_name}}.

Here's everything for your committee so nothing waits on me. The in-person fee for {{event_city}} is {{list_fee}} plus a {{travel_stipend}} travel buyout. Speaker reel: {{reel_url}}. A few notes from {{industry}} groups I've worked with: {{testimonials_url}}.

{{tailoring_paragraph}}

How does that land? Happy to talk through what fits your budget.

Best,
Ben
```

*Fee same day, always. tailoring_paragraph is written by the drafts engine from the call notes (one short paragraph, their words back to them). If they gave a budget on the call, the engine swaps in the negotiation line from E04b.*

## E04b · Proposal with budget known
**Stage:** Qualified · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Discovery call held and client stated a budget cap

**Subject:** Keynote Details

```
Great call today, thanks {{first_name}}.

My standard in-person fee is {{list_fee}} plus a {{travel_stipend}} travel buyout. You mentioned {{stated_budget}}. {{flex_reason}} so I've got some flexibility here. Could you commit to {{offer_fee}} all in?

Reel for the committee: {{reel_url}}.

Let me know and Liezel can get the agreement over.

Best,
Ben
```

*Only Ben sets offer_fee. flex_reason is a true anchor (already in the region that week, local to LA, bundling). Pricing is never automated.*

## E05 · Soft check-in
**Stage:** Qualified · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Liezel · **Register:** Formal
**Trigger:** Next Action Date passed, first follow-up, no decision date set

**Subject:** Checking In

```
Hi {{first_name}},

Hope you had a great weekend. Any word from the team on {{event_date}}?

Thanks,
Liezel
```

*Used once, then escalate to E06. Follow-Up Count 0 to 1 is Liezel.*

## E06 · Hold release (forcing email)
**Stage:** Qualified · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Decision Date passed with no reply, or second unanswered follow-up

**Subject:** Your Date

```
Hi {{first_name}},

Are you still considering me for {{event_date}}? If not, no problem at all, just let me know and I'll release the hold.

If you're close and need more time, I'm happy to hold it. When are you meeting next?

Thanks,
Ben
```

*Follow-Up Count 2+ goes to Ben. Forces an answer either way. Nothing is released until a human marks it.*

## E07 · First right of refusal notice
**Stage:** Firm Offer · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** A later hold on the same date reaches Firm Offer. DRAFT ONLY. Ben resolves the Date Conflict first.

**Subject:** Your Hold

```
Hi {{first_name}},

Quick heads up. I've had a firm request come in for {{event_date}} and you've had the first hold on that date. I'd love to make yours work.

Can you let me know by {{deadline}} whether you're ready to move to contract? If the timing's not right, no worries at all, just say so and I'll release it.

Thanks,
Ben
```

*Never auto-sent. Ben sees both deals (clients, cities, stage times) before choosing. Sometimes two gigs in one day is doable. deadline is blank until Ben sets it.*

## E08 · Contract details request
**Stage:** Closed-Won · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Deal marked Closed-Won (direct)

**Subject:** Agreement

```
So glad we're doing this, {{first_name}}.

Liezel, can you please send {{first_name}} the agreement for {{event_date}}? We just need the signer's name and billing address.

Thanks,
Ben
```

*Delegation in the open. Liezel cc'd and named.*

## E09 · Invoice
**Stage:** Closed-Won · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Liezel · **Register:** Formal
**Trigger:** Contract signed

**Subject:** Invoice

```
Hi {{first_name}},

Attached is the invoice for Ben's keynote on {{event_date}}. Payment is due on signing and the full amount must be received before the event date. If your AP team needs specific terms, let me know and we will do our best to accommodate.

Thanks,
Liezel
```

*Contractual language allowed here (do not / must). Direct lane only. Bureau deals: the bureau invoices.*

## E10 · Welcome kit
**Stage:** Closed-Won · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Invoice shared (sequence: Closed-Won, contract signed, invoice shared, then kit)

**Subject:** Welcome Kit

```
Hi {{first_name}},

Here's your welcome kit for {{event_date}}: {{kit_url}}. It walks through the pre-event call, AV, logistics, and the day itself.

The one ask right now is the short questionnaire linked inside. It's what I build the keynote from. Can you get it back to me by {{questionnaire_due}}?

Liezel's cc'd for anything logistics. Excited for this one.

Thanks,
Ben
```

*Kit is a hosted page rendered from the deal. Fires after invoice, not at Closed-Won.*

## E11 · Welcome kit to agent
**Stage:** Closed-Won · **Lane:** Bureau · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** Bureau confirms booking

**Subject:** Welcome Kit

```
Hey {{agent_first}},

Welcome kit for {{end_client}} is here: {{kit_url}}. Can you forward it along to the client?

The questionnaire inside is the big one, it's what I build from. Liezel's cc'd for logistics.

Thanks,
Ben
```

*Automation stops here on bureau deals. Agent owns client follow-up.*

## E12 · Questionnaire link
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Keynote · **Send:** AUTO · **From:** Liezel · **Register:** Formal
**Trigger:** Kick-off call booked

**Subject:** Pre-Event Questionnaire

```
Hi {{first_name}},

Here's the pre-event questionnaire for {{event_date}}: {{questionnaire_url}}. We've filled in what we already know so it should only take about 10 minutes.

Thanks,
Liezel
```

*Second and last client-facing auto-send. Form is pre-populated from the deal.*

## E13 · Questionnaire chase
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** T-14 and questionnaire not returned

**Subject:** Quick Nudge

```
Hi {{first_name}},

Gentle nudge on the questionnaire for {{event_date}}: {{questionnaire_url}}. Even rough answers help. I'd rather have them early than perfect.

Thanks,
Ben
```

## E14 · Debrief scheduling
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Kick-off call held

**Subject:** Debrief

```
Great call today, thanks {{first_name}}.

Let's put the debrief on the calendar now so it's one less thing later. Two weeks after the event, {{debrief_slot}}?

Liezel will send the invite.

Thanks,
Ben
```

*Booked at kick-off, never chased afterwards. Bureau lane: only with agent buy-in, agent cc'd.*

## E15 · Journal promo address
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Liezel · **Register:** Friendly
**Trigger:** Ben mentions the journal on the kick-off call (line item added at Mentioned)

**Subject:** Journal

```
Hi {{first_name}},

Ben mentioned the journal on your call. I'd love to send you a copy so you can see it in person. What's the best address to ship to?

Thanks,
Liezel
```

*Fulfillment record moves to Promo Sent when it ships.*

## E15b · Journal follow-up
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** 7 days after promo shipped

**Subject:** Journal

```
Hi {{first_name}},

Did the journal make it to you? If you think it'd be a good fit for the room on {{event_date}}, let me know roughly how many and Liezel can put together pricing.

Bulk orders take a couple of weeks from the warehouse so earlier is easier.

Thanks,
Ben
```

*Timer nudges internally at T-45 and T-35 if no order. Pricing tiers live in Products.*

## E16 · Field guide brief (internal)
**Stage:** Pre-Event · **Lane:** Any · **Type:** Keynote · **Send:** AUTO · **From:** Louis · **Register:** System
**Trigger:** T-1 or Ben presses the button

**Subject:** Field Guide {{deal_name}}

```
{{event_name}} in {{event_city}} on {{event_date}}.

AV check {{av_check_time}} {{event_timezone}}. Stage time {{stage_time}}. Duration {{duration}}.
Venue {{venue_name}}, {{venue_address}}, {{ballroom}}.
Hotel {{hotel_name}}, conf {{hotel_confirmation}}. Ground {{ground_transport}}.
Onsite contact {{onsite_name}} {{onsite_phone}}.
Audience {{audience_overview}}. Theme {{event_theme}}. Focus {{focus_areas}}.
Journal order {{journal_qty}} ({{fulfillment_status}}).
Notes {{client_team_notes}}.
```

*Internal, plain, Ben's chosen fields only. Already built.*

## E17 · Post-keynote alert (internal)
**Stage:** Delivered · **Lane:** Any · **Type:** Keynote · **Send:** AUTO · **From:** Louis · **Register:** System
**Trigger:** Ben ticks Send Post-Keynote Alert

**Subject:** Post-Keynote {{deal_name}}

```
Ben's post-keynote notes for {{deal_name}}:

{{post_keynote_notes}}

Deal: {{deal_url}}
```

*One-click handoff to Liezel. Ben types once.*

## E18 · Thank you, deck, testimonial
**Stage:** Delivered · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Event date passed (next day)

**Subject:** Thank You

```
Hi {{first_name}},

It was an honor to speak to {{company}} {{day_word}} in {{event_city}}. {{specific_detail}}

Here's the deck for the team: {{deck_url}}.

One small ask. If you've got two lines on how it landed, I'd love to use them as a testimonial.

Thanks 100x for having me.
Ben
```

*specific_detail comes from Ben's post-keynote notes (their moment, not his content). Bureau lane: agent cc'd, no testimonial ask unless agent agrees.*

## E19 · QR follow-up
**Stage:** Delivered · **Lane:** Any · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Audience member ticks interest and completes the qualifier drop-down

**Subject:** Great Meeting You

```
Hi {{first_name}},

Thank you again for attending my keynote {{day_word}} in {{event_city}}!

I saw that you checked the box expressing interest in having me speak at an upcoming event, so I wanted to reach out.

I'm curious, do you already have an event date or audience in mind?

Happy to jump on a quick exploratory call and share a few ways I've partnered with {{their_industry}} groups to create energizing experiences.

Safe travels home!
Ben
```

*Model email from Ben's sent mail. Only fires for qualified clicks (drop-down completed). Creates a new Inquiry deal, Source = Audience Capture.*

## E20 · Next year
**Stage:** Debriefed · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Debrief held and repeat flagged

**Subject:** Next Year

```
Hi {{first_name}},

Thanks again for {{event_name}}. I've been thinking about next year. If we spoke to your leaders this time, what about the managers or the wider team?

Happy to sketch a couple of options if that's useful.

Hope all is well in your world.
Ben
```

*A yes creates a new standalone deal linked to the same company.*

## E21 · Re-engagement, timing or budget
**Stage:** Closed Lost · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** 12 months after Closed Lost with reason Dates, Budget, Unresponsive, or Event cancelled

**Subject:** Your Event

```
Hi {{first_name}},

We talked about {{event_name}} last {{year}} and the timing didn't line up. I've got {{month}} opening up and thought of you.

{{social_proof_line}}

Do you have anything on the calendar for {{next_year}}?

Best,
Ben
```

*Segmented by Closed Lost Reason and industry. social_proof_line is one sentence, same industry if possible.*

## E21b · Re-engagement, hired another speaker
**Stage:** Closed Lost · **Lane:** Direct · **Type:** Keynote · **Send:** DRAFT · **From:** Ben · **Register:** Formal
**Trigger:** 12 months after Closed Lost with reason Hired another speaker or Referred

**Subject:** Next Event

```
Hi {{first_name}},

Hope {{event_name}} went great last {{year}}. If you're already planning {{next_year}}, I'd love to be in the mix.

Recent reel: {{reel_url}}.

Any dates in mind?

Best,
Ben
```

## E22 · Coaching intake reply
**Stage:** Inquiry · **Lane:** Direct · **Type:** Coaching · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Form or email inquiry with Deal Type Speaker or Executive Coaching

**Subject:** Coaching

```
Hi {{first_name}},

Thanks for reaching out about coaching. It's three sessions a few weeks apart and we go deep on your talk, your business, or both.

Are you free this week for a short call to see if it's a fit? {{slot_1}} or {{slot_2}} PT?

Thanks,
Ben
```

*Coaching automations are later phase. Templates ship now so the drafts engine can use them when wired.*

## E22b · Coaching diagnostic offer
**Stage:** Closed Lost · **Lane:** Direct · **Type:** Coaching · **Send:** DRAFT · **From:** Ben · **Register:** Friendly
**Trigger:** Coaching deal Closed Lost with reason Insufficient budget

**Subject:** One Session

```
Hi {{first_name}},

Totally understand the full program's a lot right now. If it helps, I do a single diagnostic session where we tear down your talk and map the next steps.

Want me to send details?

Ben
```

*Diagnostic session price is a Products value, not in the copy.*

## E22c · Coaching session follow-up
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Coaching · **Send:** DRAFT · **From:** Ben · **Register:** Casual
**Trigger:** Coaching session held (Fathom recording available)

**Subject:** Session Notes

```
Hey {{first_name}},

Great session today. Recording and notes are here: {{fathom_url}}.

Homework before next time: {{homework}}.

See you {{next_session_date}}.
Ben
```

*Ben's clearest small win to automate. Later phase.*

## E22d · Next track
**Stage:** Pre-Event · **Lane:** Direct · **Type:** Coaching · **Send:** DRAFT · **From:** Ben · **Register:** Casual
**Trigger:** Session 3 booked

**Subject:** What's Next

```
Hey {{first_name}},

Session three's on the books for {{session_3_date}}. Before we wrap, want to talk about what's next? A few people roll straight into {{next_track}}.

Happy to lay it out on the call.
Ben
```

*So Ben doesn't sell in-session.*

## E23 · Daily next-action digest (internal)
**Stage:** Any · **Lane:** Any · **Type:** Any · **Send:** AUTO · **From:** Louis · **Register:** System
**Trigger:** Daily 7:00 PT, per Next Action Owner, muted excluded

**Subject:** Louis Digest {{date}}

```
{{owner_first}}, {{count}} deals need a next action today.

{{deal_list_with_next_action_and_days_overdue}}

Open date conflicts: {{conflict_count}}.
Review queue: {{queue_count}} items.

{{app_url}}
```

*Staleness engine. Excludes Muted. Clears on Closed Won or Lost.*

## E24 · Worker failure (internal)
**Stage:** Any · **Lane:** Any · **Type:** Any · **Send:** AUTO · **From:** Louis · **Register:** System
**Trigger:** Any worker non-zero exit, extraction error, mirror error, or usage cap hit

**Subject:** Louis Failure {{worker_name}}

```
{{worker_name}} failed at {{timestamp}}.

{{error_summary}}

Log tail:
{{log_tail}}

Job queued for retry: {{retry_status}}.
```

*Never batched. Goes to admin immediately.*

---
## Variable dictionary

All variables resolve from the deal, its company, contacts, logistics, fulfillment, the social-proof resolver, or speaker config. Unresolvable variables block the draft and flag it in the queue.

`agent_first`, `app_url`, `audience_overview`, `av_check_time`, `ballroom`, `client_team_notes`, `company`, `conflict_count`, `count`, `date`, `day_word`, `deadline`, `deal_list_with_next_action_and_days_overdue`, `deal_name`, `deal_url`, `debrief_slot`, `deck_url`, `duration`, `end_client`, `end_client_or_bureau`, `error_summary`, `event_city`, `event_date`, `event_date_or_TBD`, `event_name`, `event_name_or_company`, `event_theme`, `event_timezone`, `fathom_url`, `first_name`, `flex_reason`, `focus_areas`, `fulfillment_status`, `ground_transport`, `homework`, `hotel_confirmation`, `hotel_name`, `industry`, `industry_line`, `journal_qty`, `kit_url`, `list_fee`, `log_tail`, `month`, `next_session_date`, `next_track`, `next_year`, `offer_fee`, `onsite_name`, `onsite_phone`, `owner_first`, `post_keynote_notes`, `questionnaire_due`, `questionnaire_url`, `queue_count`, `reel_url`, `region`, `related_clients_line`, `retry_status`, `session_3_date`, `slot_1`, `slot_2`, `social_proof_line`, `specific_detail`, `stage_time`, `stated_budget`, `tailoring_paragraph`, `testimonial_attribution`, `testimonial_quote`, `testimonials_url`, `their_industry`, `timestamp`, `travel_stipend`, `venue_address`, `venue_name`, `worker_name`, `year`
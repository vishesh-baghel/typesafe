/**
 * The sample corpus: 40 hand-written emails, no real content, ever.
 *
 * The mix mirrors the real 50-thread sample measured in Phase 1 rather than being invented:
 * 10 newsletters, 10 transaction alerts, 4 job alerts, 5 promotional, 3 event invites,
 * 3 receipts, 5 that genuinely need action.
 *
 * Five rows exist specifically to carry the PRD's edge cases into the demo, so a visitor can see
 * the hard parts rather than read about them:
 *
 *   c-declined   a card alert that DOES need action, sitting among nine that do not. The trap.
 *   c-cfp        a newsletter carrying a real deadline. Should batch, not surface.
 *   c-cc         a thread the recipient is cc'd on. Written by a person, but not for them.
 *   c-nobody     an alert with no body at all. Three questions get skipped.
 *   c-urgentad   promotional mail engineered to read as urgent. It WILL surface, and the README
 *                says so. Pinned as a known weakness rather than hidden.
 *
 * Bodies are written as the HTML an email actually arrives as, then pushed through
 * lib/normalize so the corpus is shaped by the same code the production path uses.
 */
import { writeFileSync } from 'node:fs';
import { normalizeBody, senderDomain } from '../lib/normalize';
import type { Email } from '../lib/types';

interface Draft {
  id: string;
  sender: string;
  subject: string;
  html: string;
  category: string;
  isReplyToRecipient?: boolean;
}

const DRAFTS: Draft[] = [
  // ---------------------------------------------------------------- needs action (5)
  {
    id: 'c-deploy',
    sender: 'notifications@deployhost.example',
    subject: 'Production deployment failed for storefront-web',
    category: 'needs_action',
    html: `<p>Hello, riverbend.</p><p>The production deployment for <b>storefront-web</b> failed at
      commit 4f2a119.</p><pre>Error: build exceeded memory limit (2048 MB)</pre>
      <p>Your last successful deployment is still serving traffic.</p>`,
  },
  {
    id: 'c-declined',
    sender: 'alerts@northbank.example',
    subject: 'Card ending 4417 was declined',
    category: 'transaction_alert',
    html: `<p>Dear customer,</p><p>A recurring charge of <b>$89.00</b> to CLOUDHOST INC was
      <b>declined</b> on 16/09/26 because the card on file has expired.</p>
      <p>The merchant will retry once. Update your card to avoid interruption.</p>`,
  },
  {
    id: 'c-domain',
    sender: 'billing@domainkeeper.example',
    subject: 'riverbend.example.com expires in 6 days',
    category: 'needs_action',
    html: `<p>Your domain <b>riverbend.example.com</b> expires on 24 September 2026.</p>
      <p>Auto-renew is <b>off</b>. If it lapses the domain enters a 30-day redemption period and
      a restore fee applies.</p>`,
  },
  {
    id: 'c-ci',
    sender: 'notifications@repohost.example',
    subject: '[riverbend/storefront] CI failed on main: 3 jobs',
    category: 'needs_action',
    html: `<p>Workflow <b>CI</b> failed on <code>main</code>.</p>
      <ul><li>lint - failed in 12s</li><li>typecheck - failed in 41s</li><li>test - cancelled</li></ul>
      <p>main is red. Deploys are blocked until this is green.</p>`,
  },
  {
    id: 'c-verify',
    sender: 'login@metrics.example',
    subject: 'Verify your address to activate Metrics',
    category: 'needs_action',
    html: `<p>Your workspace is reserved but stays inactive until the address on it is verified.</p>
      <p><a href="https://metrics.example/verify">Verify address</a></p>
      <p>The link stops working after 24 hours and a new one has to be requested.</p>`,
  },

  // ---------------------------------------------------------------- transaction alerts (9 more)
  {
    id: 'c-txn1',
    sender: 'alerts@northbank.example',
    subject: 'Card ending 4417: $12.40 at GREENLEAF CAFE',
    category: 'transaction_alert',
    html: `<p>A purchase of <b>$12.40</b> was made at GREENLEAF CAFE on 17/09/26.</p>
      <p>Available balance: $2,184.02.</p>`,
  },
  {
    id: 'c-txn2',
    sender: 'alerts@northbank.example',
    subject: 'Transfer of $1,500.00 completed',
    category: 'transaction_alert',
    html: `<p>Your transfer of <b>$1,500.00</b> to SAVINGS ****9921 completed on 16/09/26.</p>
      <p>No action is needed.</p>`,
  },
  {
    id: 'c-txn3',
    sender: 'noreply@paylink.example',
    subject: 'You received $340.00 from Harbour Studio',
    category: 'transaction_alert',
    html: `<p><b>$340.00</b> from Harbour Studio has landed in your balance.</p>
      <p>It will be paid out on the next scheduled payout.</p>`,
  },
  {
    id: 'c-txn4',
    sender: 'statements@northbank.example',
    subject: 'Your September statement is ready',
    category: 'transaction_alert',
    html: `<p>Your statement for the period 01/09/26 to 30/09/26 is ready to view.</p>`,
  },
  {
    id: 'c-txn5',
    sender: 'alerts@brokerline.example',
    subject: 'Portfolio summary as of 15-Sep-2026',
    category: 'transaction_alert',
    html: `<p>Invested value: $4,210.00. Market value: $4,388.20. Unrealised gain: +$178.20 (4.2%).</p>`,
  },
  {
    id: 'c-txn6',
    sender: 'alerts@northbank.example',
    subject: 'Direct debit of $42.00 to CITY UTILITIES',
    category: 'transaction_alert',
    html: `<p>A direct debit of <b>$42.00</b> to CITY UTILITIES was taken on 15/09/26.</p>`,
  },
  {
    id: 'c-txn7',
    sender: 'noreply@paylink.example',
    subject: 'Payout of $1,120.00 is on its way',
    category: 'transaction_alert',
    html: `<p>Your payout of <b>$1,120.00</b> was sent to ****4417 and should arrive in 1-2 days.</p>`,
  },
  {
    id: 'c-txn8',
    sender: 'alerts@northbank.example',
    subject: 'Sign-in from a new device',
    category: 'transaction_alert',
    html: `<p>Your account was accessed from Chrome on macOS at 09:14 on 17/09/26.</p>
      <p>If this was you, no action is needed.</p>`,
  },
  {
    id: 'c-txn9',
    sender: 'alerts@brokerline.example',
    subject: 'Weekly register of holdings, w/e 12 Sep 2026',
    category: 'transaction_alert',
    html: `<p>Please find attached the register of securities and funds for the period 07 Sep to 12 Sep 2026.</p>`,
  },

  // ---------------------------------------------------------------- newsletters (10)
  {
    id: 'c-news1',
    sender: 'hello@thelongshort.example',
    subject: 'The compounding trap',
    category: 'newsletter',
    html: `<p>Good morning. Everything compounds, including the things you would rather it did not.
      This week: three founders who measured the wrong number for a year.</p>`,
  },
  {
    id: 'c-news2',
    sender: 'digest@buildweekly.example',
    subject: 'Issue #114: the case against microservices, again',
    category: 'newsletter',
    html: `<p>Welcome to issue 114. This month we look at four teams that consolidated back to a
      monolith and what it cost them.</p>`,
  },
  {
    id: 'c-cfp',
    sender: 'programme@systemsconf.example',
    subject: 'SystemsConf 2027: call for proposals closes 3 October',
    category: 'newsletter',
    html: `<p>Our call for proposals closes at <b>23:59 UTC on 3 October 2026</b>.</p>
      <p>We are looking for talks on operating distributed systems at small scale. Anyone may
      submit; there is no invitation and no obligation.</p>`,
  },
  {
    id: 'c-news4',
    sender: 'updates@calendarapp.example',
    subject: 'Changelog: version 6.9',
    category: 'newsletter',
    html: `<p>This month: workflows 2.0, a rebuilt troubleshooter, and 31 fixes.</p>`,
  },
  {
    id: 'c-news5',
    sender: 'notes@quietmornings.example',
    subject: '3-2-1: on finishing things',
    category: 'newsletter',
    html: `<p>Three ideas, two quotes, one question. This week on the difference between
      abandoning a project and completing it badly.</p>`,
  },
  {
    id: 'c-news6',
    sender: 'team@dataplane.example',
    subject: 'Product update, September',
    category: 'newsletter',
    html: `<p>Your queries can now run on the new planner. Set it once in settings and about 90
      percent of workloads pick it up automatically.</p>`,
  },
  {
    id: 'c-news7',
    sender: 'markets@brokerline.example',
    subject: 'Morning wrap: index slips 1.04%',
    category: 'newsletter',
    html: `<p>Key takeaways: the index closed down 1.04 percent, led by financials. Volumes were
      thin ahead of the weekend.</p>`,
  },
  {
    id: 'c-news8',
    sender: 'hello@thelongshort.example',
    subject: 'The two kinds of expensive',
    category: 'newsletter',
    html: `<p>Good morning. There is expensive-because-rare and expensive-because-slow, and
      confusing them is how budgets die.</p>`,
  },
  {
    id: 'c-news9',
    sender: 'brief@morningops.example',
    subject: 'Thursday brief: verification is the bottleneck',
    category: 'newsletter',
    html: `<p>Morning. Thursday has a clean build-and-distribute shape. One fresh signal worth
      noting in the agent tooling space.</p>`,
  },
  {
    id: 'c-news10',
    sender: 'digest@buildweekly.example',
    subject: 'Issue #115: what a good postmortem looks like',
    category: 'newsletter',
    html: `<p>Welcome to issue 115. A blameless postmortem template that three readers sent in,
      plus the section everyone skips.</p>`,
  },

  // ---------------------------------------------------------------- job alerts (4)
  {
    id: 'c-job1',
    sender: 'jobalerts@talentfeed.example',
    subject: 'Northwind Systems is hiring a Senior Backend Engineer',
    category: 'job_alert',
    html: `<p>Northwind Systems, Senior Backend Engineer. Remote, full time. Matching your saved
      search "backend, remote".</p>`,
  },
  {
    id: 'c-job2',
    sender: 'jobalerts@talentfeed.example',
    subject: '9 new roles matching "platform engineer"',
    category: 'job_alert',
    html: `<p>Nine new roles this week matching your saved search, including three at companies
      you follow.</p>`,
  },
  {
    id: 'c-job3',
    sender: 'jobs@rolesboard.example',
    subject: 'Aldergrove Labs is hiring a Full Stack Developer',
    category: 'job_alert',
    html: `<p>Aldergrove Labs, Full Stack Developer. Hybrid, 3 days on site.</p>`,
  },
  {
    id: 'c-job4',
    sender: 'jobalerts@talentfeed.example',
    subject: 'Your weekly job digest',
    category: 'job_alert',
    html: `<p>14 roles matched your searches this week. Nobody has contacted you directly.</p>`,
  },

  // ---------------------------------------------------------------- promotional (5)
  {
    id: 'c-urgentad',
    sender: 'notice@domainkeeper.example',
    subject: 'Alert: your products are at risk',
    category: 'promotional',
    html: `<p><b>Immediate attention required.</b> To avoid losing your items, upgrade to the
      Premium plan now. Offer ends at midnight.</p>
      <p>Your existing services are unaffected and no payment is overdue.</p>`,
  },
  {
    id: 'c-promo2',
    sender: 'offers@domainkeeper.example',
    subject: 'riverbend.io was taken, but you have options',
    category: 'promotional',
    html: `<p>The domain you searched is registered. Here are eight alternatives from $9.99.</p>`,
  },
  {
    id: 'c-promo3',
    sender: 'hello@dataplane.example',
    subject: 'Plenty is new since your last visit',
    category: 'promotional',
    html: `<p>Managed storage, a query planner and hosting in one place. The starter tier is free
      and needs no card.</p>`,
  },
  {
    id: 'c-promo4',
    sender: 'deals@travelcard.example',
    subject: 'Trips abroad, planned by experts',
    category: 'promotional',
    html: `<p>Every "what if" abroad is answered before you land. Talk to a planner today.</p>`,
  },
  {
    id: 'c-promo5',
    sender: 'sellers@marketplace.example',
    subject: 'You have 3 messages from sellers',
    category: 'promotional',
    html: `<p>Scroll below and check your messages.</p>`,
  },

  // ---------------------------------------------------------------- event invites (3)
  {
    id: 'c-event1',
    sender: 'events@systemsconf.example',
    subject: 'You are invited: Operating at Small Scale',
    category: 'event_invite',
    html: `<p>A one-day conference for people who run systems without a platform team.
      21 October, and there is a livestream if you cannot travel.</p>`,
  },
  {
    id: 'c-event2',
    sender: 'meetups@localdevs.example',
    subject: 'September meetup: observability on a budget',
    category: 'event_invite',
    html: `<p>Doors at 18:30, talks at 19:00. Free, and there is pizza.</p>`,
  },
  {
    id: 'c-event3',
    sender: 'webinars@dataplane.example',
    subject: 'Live demo: the new query planner',
    category: 'event_invite',
    html: `<p>Join our engineers for a 30-minute walkthrough and Q&amp;A. Recording sent to
      everyone who registers.</p>`,
  },

  // ---------------------------------------------------------------- receipts (3)
  {
    id: 'c-rcpt1',
    sender: 'receipts@cloudhost.example',
    subject: 'Your receipt from CloudHost #2026-4471',
    category: 'receipt',
    html: `<p>Thanks for your payment of <b>$89.00</b>. Invoice 2026-4471 is paid in full.</p>`,
  },
  {
    id: 'c-rcpt2',
    sender: 'orders@marketplace.example',
    subject: 'Your order has shipped',
    category: 'receipt',
    html: `<p>Order #88412 shipped today and should arrive Friday. Tracking is in your account.</p>`,
  },
  {
    id: 'c-rcpt3',
    sender: 'receipts@calendarapp.example',
    subject: 'Receipt for your annual plan',
    category: 'receipt',
    html: `<p>Payment of <b>$144.00</b> received. Your plan renews 17 September 2027.</p>`,
  },

  // ---------------------------------------------------------------- edge cases (2)
  {
    id: 'c-cc',
    sender: 'dana@harbourstudio.example',
    subject: 'Re: handover notes for the Tuesday migration',
    category: 'personal',
    isReplyToRecipient: false,
    html: `<p>Thanks Priya, that covers it. I have added the rollback steps to the shared doc.</p>
      <p>Copying Sam so he has the context on Tuesday. Nothing needed from anyone else.</p>
      <p>On Tue, Priya wrote:</p><blockquote>Here are the handover notes...</blockquote>`,
  },
  {
    id: 'c-nobody',
    sender: 'monitor@statuswatch.example',
    subject: 'storefront-web: response time back to normal',
    category: 'automated_notification',
    html: ``,
  },
];

function main() {
  const seen = new Set<string>();
  const corpus: (Email & { category: string })[] = DRAFTS.map((d) => {
    if (seen.has(d.id)) throw new Error(`duplicate id: ${d.id}`);
    seen.add(d.id);
    // RFC 2606 reserves `.example` as a TLD as well as example.com/net/org. Using
    // `<brand>.example` rather than `<brand>.example.com` matters: senderDomain() keeps the last
    // two labels, so every `*.example.com` sender would collapse to the single string
    // "example.com" and every proposed rule would read "automated mail from example.com". The
    // reserved TLD keeps senders distinct while still resolving nowhere.
    if (!/@[a-z0-9-]+\.example$/.test(d.sender)) {
      throw new Error(`sender must be <brand>.example, a reserved TLD: ${d.sender}`);
    }
    return {
      id: d.id,
      sender: d.sender,
      senderDomain: senderDomain(d.sender),
      subject: d.subject,
      bodyText: normalizeBody(d.html),
      isReplyToRecipient: d.isReplyToRecipient ?? false,
      category: d.category,
    };
  });

  /**
   * 41, not the plan's 40. Two reasons, both recorded rather than papered over by deleting a row:
   * the plan's mix counted the declined-card alert twice (once as a transaction alert, once as a
   * needs-action email), and `c-cc` and `c-nobody` were added afterwards to carry two PRD edge
   * cases into the demo. An extra edge case is worth more than a round number.
   */
  if (corpus.length !== 41) throw new Error(`expected 41 emails, got ${corpus.length}`);
  const needsActionish = corpus.filter((e) =>
    ['c-deploy', 'c-declined', 'c-domain', 'c-ci', 'c-verify'].includes(e.id),
  );
  if (needsActionish.length !== 5) throw new Error('the five needs-action rows must all be present');

  writeFileSync('data/corpus.json', JSON.stringify(corpus, null, 2));

  const by = corpus.reduce<Record<string, number>>((a, e) => {
    a[e.category] = (a[e.category] ?? 0) + 1;
    return a;
  }, {});
  console.log(`wrote data/corpus.json: ${corpus.length} emails`);
  console.log(by);
  console.log(`empty bodies: ${corpus.filter((e) => e.bodyText === '').length}`);
}

main();

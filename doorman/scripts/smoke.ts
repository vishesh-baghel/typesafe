/**
 * Cheapest possible check that the key, the state shape and the question set all work.
 * One email, eight answers, and the usage the README's cost claim depends on.
 */
import { judge } from '../lib/jev';
import { formatCost } from '../lib/cost';
import { normalizeBody, senderDomain } from '../lib/normalize';
import type { Email } from '../lib/types';

const RAW = `<p>Dear Customer,</p><p>An amount of <b>INR 240.00</b> has been DEBITED on
17/09/26 from your account XXXXX02180 to Man Bahadur with UPI Ref No.:626085832411.</p>`;

async function main() {
  const sender = 'canarabank@canarabank.com';
  const email: Email = {
    id: 'smoke-1',
    sender,
    senderDomain: senderDomain(sender),
    subject: 'UPI Transaction Alert',
    bodyText: normalizeBody(RAW),
    isReplyToRecipient: false,
  };

  console.log(`state body: ${JSON.stringify(email.bodyText.slice(0, 90))}...\n`);

  const res = await judge(email);
  if (!res.battery) {
    console.error('FAILED:', res.failure);
    process.exit(1);
  }

  const b = res.battery;
  const pct = (n: number | null) => (n === null ? '  n/a' : n.toFixed(2).padStart(5));
  console.log('  needs_recipient_action  ', pct(b.needs_recipient_action));
  console.log('  reports_completed_event ', pct(b.reports_completed_event));
  console.log('  costs_money             ', pct(b.costs_money));
  console.log('  is_irreversible         ', pct(b.is_irreversible));
  console.log('  states_a_deadline       ', pct(b.states_a_deadline));
  console.log('  is_promotional          ', pct(b.is_promotional));
  console.log('  written_by_a_person     ', pct(b.written_by_a_person));
  console.log(
    `  consequence_if_ignored   ${b.consequence.score.toFixed(2)} at ${b.consequence.confidence.toFixed(2)} confidence`,
  );
  console.log(`\n  usage: ${res.usage?.input_tokens} input tokens, ${formatCost(res.usage!)}`);
  console.log('\nThe trap: a bank alert should score LOW on action and HIGH on completed event.');
}

main().catch((err) => {
  console.error('\nSmoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

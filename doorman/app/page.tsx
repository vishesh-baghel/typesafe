import Triage from '../components/Triage';
import { ALL_JUDGED, CORPUS, SEED_RULES, SNAPSHOT_USAGE, seedMatches } from '../lib/corpus';
import { dbConfigured } from '../lib/db';
import { dollars } from '../lib/cost';

/**
 * Server component. Reads the committed snapshot and hands it to the client whole.
 *
 * Nothing here calls the model. The judgments were bought once by `pnpm judge-corpus`, so this
 * page renders with no TYPESAFE_API_KEY present and a threshold change costs nothing.
 */
export default function Page() {
  const seeded: Record<string, Record<string, number>> = {};
  for (const [emailId, per] of seedMatches()) seeded[emailId] = Object.fromEntries(per);

  return (
    <main className="wrap">
      <header className="top">
        <h1>Doorman</h1>
        <span className="tag">what actually needs you</span>
        <span className="spacer" />
        <span className="tag">
          {CORPUS.length} sample emails · {SEED_RULES.length} rules
        </span>
      </header>

      <Triage
        emails={CORPUS.map((e) => ({ id: e.id, sender: e.sender, senderDomain: e.senderDomain, subject: e.subject }))}
        judged={ALL_JUDGED.map((j) => ({ id: j.email.id, battery: j.battery, failure: j.failure }))}
        seedRules={SEED_RULES}
        seedMatches={seeded}
        dbConfigured={dbConfigured()}
        snapshotCost={dollars(SNAPSHOT_USAGE)}
        snapshotTokens={SNAPSHOT_USAGE.input_tokens}
      />
    </main>
  );
}

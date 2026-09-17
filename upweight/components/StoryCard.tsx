'use client';

import { DIMS, type Weights } from '@/lib/composite';
import { exactAge, relativeAge } from '@/lib/format';
import type { ScoredStory } from '@/lib/types';

interface Props {
  story: ScoredStory;
  position: number;
  score: number;
  maxAbs: number;
  weights: Weights;
  open: boolean;
  questions: unknown;
  model: string;
  onToggleRaw: (id: number) => void;
}

const HOT = 60;

export function StoryCard({
  story, position, score, maxAbs, weights, open, questions, model, onToggleRaw,
}: Props) {
  const pct = (Math.abs(score) / maxAbs) * 50;
  const negative = score < 0;

  return (
    <li className="story" data-sid={story.id}>
      {/* data-moved is set imperatively by the FLIP effect in Ranker, which is the
          only place that knows whether this row rose or fell. */}
      <span className="story__rank num">{String(position).padStart(2, '0')}</span>

      <div>
        <h3 className="story__title">
          <a href={story.url} target="_blank" rel="noopener noreferrer">
            {story.title}
          </a>
        </h3>

        <div className="story__meta">
          <span className="story__src">{story.source}</span>
          <span>{story.points} pts</span>
          <a
            className="story__hn"
            href={`https://news.ycombinator.com/item?id=${story.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {story.commentCount} comments
          </a>
          <span title={exactAge(story.ageHours)}>{relativeAge(story.ageHours)}</span>
          {story.flags && story.flags.hasOriginalResearch > 0.7 && (
            <span className="pill pill--flag">original research</span>
          )}
          {story.flags && story.flags.isRageBait > 0.6 && (
            <span className="pill pill--warn">rage bait</span>
          )}
          {/*
            Keys off hasArticle, not evidenceStrength. Phase 1 measured that a
            no-article story now averages high confidence across the two dimensions it
            could answer, so an evidence threshold alone would never fire here.
          */}
          {!story.hasArticle && (
            <span className="pill pill--thin" title="No article could be fetched, so only drama and career relevance were scored">
              scored on 2 of 6
            </span>
          )}
          {story.hasArticle && story.evidenceStrength < 0.4 && (
            <span className="pill pill--thin">thin evidence</span>
          )}
        </div>

        <div className="story__score">
          <span className="score-bar">
            <span
              className="score-bar__fill"
              data-neg={negative}
              style={{ left: `${negative ? 50 - pct : 50}%`, width: `${pct}%` }}
            />
          </span>
          <span className="score-val num">
            {score >= 0 ? '+' : ''}
            {score.toFixed(3)}
          </span>
        </div>

        <div className="dims">
          {DIMS.map((dim) => {
            const d = story.scores[dim.key];
            const hot = Math.abs(weights[dim.key]) >= HOT;
            return (
              <span className="dim" key={dim.key}>
                <span className="dim__k">{dim.key}</span>
                <span className="dim__bar">
                  {d.available && (
                    <span
                      className="dim__fill"
                      data-hot={hot}
                      style={{ width: `${d.value * 100}%` }}
                    />
                  )}
                </span>
                <span className="dim__n" data-hot={d.available && hot}>
                  {d.available ? d.value.toFixed(2) : 'n/a'}
                </span>
              </span>
            );
          })}
        </div>

        <div className="story__tools">
          <button
            type="button"
            className="link-btn"
            aria-expanded={open}
            onClick={() => onToggleRaw(story.id)}
          >
            {open ? 'hide request and response' : 'request and response'}
          </button>
        </div>

        {open && (
          <>
            <div className="drawer">
              <div className="drawer__bar">
                <span className="mono">request</span>
                <span className="mono">POST /v1/systemone</span>
              </div>
              <pre>
                <code>
                  {JSON.stringify(
                    { model, state: story.requestState, questions },
                    null,
                    2,
                  )}
                </code>
              </pre>
            </div>
            <div className="drawer">
              <div className="drawer__bar">
                <span className="mono">response</span>
                <span className="chip-ok">200 OK</span>
              </div>
              <pre>
                <code>{JSON.stringify({ model, answers: story.rawResponse }, null, 2)}</code>
              </pre>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

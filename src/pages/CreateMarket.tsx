import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { createMarket, getMarketById } from '../lib/api';
import { MARKET_CATEGORIES } from '../types';

const MIN_SEED = 100;

function defaultCloseTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  d.setSeconds(0, 0);
  // yyyy-MM-ddTHH:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateMarket() {
  const { session } = useAuth();
  const { openAuthModal } = useAuthModal();
  const navigate = useNavigate();

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(MARKET_CATEGORIES[0]);
  const [imageUrl, setImageUrl] = useState('');
  const [closeTime, setCloseTime] = useState(defaultCloseTime());
  const [seed, setSeed] = useState(String(MIN_SEED));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-7">
        <EmptyState
          title="Sign in to create a market"
          description="Any signed-in user can create a market by seeding initial liquidity."
          action={
            <button
              onClick={() => openAuthModal('signin')}
              className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep"
            >
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  const seedNum = Number(seed);
  const seedValid = Number.isFinite(seedNum) && seedNum >= MIN_SEED;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !closeTime || !seedValid) return;

    setSubmitting(true);
    setError(null);
    try {
      const closeIso = new Date(closeTime).toISOString();
      const fallbackImage = `https://picsum.photos/seed/${encodeURIComponent(question)}/400/400`;
      const id = await createMarket({
        question: question.trim(),
        description: description.trim(),
        category,
        image_url: imageUrl.trim() || fallbackImage,
        close_time: closeIso,
        seed: seedNum,
      });
      const market = await getMarketById(id);
      if (market) navigate(`/market/${market.slug}`);
      else navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create market');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-7">
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text-primary">
        Create a market
      </h1>
      <p className="mb-6 text-sm text-text-muted">
        Seed liquidity is deducted from your balance and set as the initial Yes/No pool.
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border-c bg-white p-5"
      >
        <div>
          <label className="mb-1.5 block text-xs font-bold text-text-muted">Question</label>
          <input
            type="text"
            required
            maxLength={200}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will X happen by Y date?"
            className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-text-muted">
            Description / resolution rules
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How will this market be resolved?"
            className="w-full resize-none rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-text-muted">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-teal"
            >
              {MARKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-text-muted">Close date</label>
            <input
              type="datetime-local"
              required
              value={closeTime}
              onChange={(e) => setCloseTime(e.target.value)}
              className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-teal"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-text-muted">
            Image URL (optional)
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://picsum.photos/400/400 (default if left blank)"
            className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-text-muted">
            Seed liquidity (USDC, min {MIN_SEED})
          </label>
          <input
            type="number"
            required
            min={MIN_SEED}
            step="1"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-teal"
          />
          {!seedValid && (
            <p className="mt-1 text-xs text-text-muted">Seed must be at least ${MIN_SEED}.</p>
          )}
        </div>

        {error && (
          <p className="rounded-xl border border-no/30 bg-no-bg px-3 py-2 text-xs font-medium text-no">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !question.trim() || !seedValid}
          className="w-full rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create market'}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-text-muted">
        <Link to="/" className="hover:text-text-primary">
          Cancel and go back
        </Link>
      </p>
    </div>
  );
}

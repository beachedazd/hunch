# Live Bet Activity — Popups + Comment Stamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire a site-wide popup whenever anyone places a bet, and stamp every bet into its market's comment thread as a visually distinct entry.

**Architecture:** Every trade insert (which happens only inside the `buy_shares` / `sell_shares` SECURITY DEFINER RPCs) is mirrored by an `AFTER INSERT` trigger into a new denormalized `bet_activity` table carrying every display field. The client subscribes to `bet_activity` inserts via Supabase realtime for popups, and `MarketDetail` queries the same table to merge stamps into the comment thread. No change to the `comments` table or the RPC bodies.

**Tech Stack:** Supabase (Postgres + realtime), React 18, @tanstack/react-query, TypeScript, Vite, Vitest, Tailwind.

## Global Constraints

- Migrations are append-only, timestamped `supabase/migrations/YYYYMMDDNNNNNN_*.sql`. Do NOT edit existing migration files.
- Writes to `markets`/`trades`/`positions`/`bet_activity` happen only through RPCs/triggers — no direct INSERT grants (mirror how `trades` works).
- `Outcome` type is `'yes' | 'no'` (`src/types.ts:5`). Market title lives in `markets.question`; link slug in `markets.slug`.
- `trades.amount` already equals the value to display: buy → notional wagered, sell → net proceeds. Use it as-is.
- Typecheck/build command: `npm run build` (`tsc -b && vite build`). Tests: `npm test` (`vitest run`).
- Reuse existing helpers: `formatUsd`, `formatCents`, `formatShares`, `formatDateTime` from `src/lib/format.ts`. Reuse the existing `ToastProvider`/`useToast` in `src/hooks/useToast.tsx` — do not add a toast library.

---

### Task 1: Database — `bet_activity` table, mirroring trigger, RLS, realtime

**Files:**
- Create: `supabase/migrations/20260708000005_bet_activity.sql`

**Interfaces:**
- Consumes: existing `public.trades`, `public.markets` (`slug`, `question`), `public.profiles` (`username`).
- Produces: table `public.bet_activity` with columns `id, market_id, market_slug, market_title, user_id, username, action, outcome, amount, shares, price, created_at`; readable by `anon` + `authenticated`; present in the `supabase_realtime` publication.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260708000005_bet_activity.sql`:

```sql
-- Live bet activity feed: one denormalized row per trade, powering the
-- site-wide popup and the in-thread comment stamps. Denormalized because the
-- realtime postgres_changes payload carries only the row's own columns (no
-- joins) — everything the UI shows must live on the row.

create table public.bet_activity (
  id            uuid primary key default gen_random_uuid(),
  market_id     uuid not null references public.markets (id) on delete cascade,
  market_slug   text not null,
  market_title  text not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  username      text,
  action        text not null check (action in ('buy', 'sell')),
  outcome       text not null check (outcome in ('yes', 'no')),
  amount        numeric(18, 6) not null,
  shares        numeric(18, 6) not null,
  price         numeric(18, 6) not null,
  created_at    timestamptz not null default now()
);

create index bet_activity_market_id_created_at_idx
  on public.bet_activity (market_id, created_at);

-- RLS: readable by everyone (incl. anon, so signed-out visitors see the feed);
-- no write policy — rows arrive only via the trigger below (SECURITY DEFINER).
alter table public.bet_activity enable row level security;

create policy bet_activity_select_all
  on public.bet_activity for select
  using (true);

grant select on public.bet_activity to anon, authenticated;

-- Mirror every trade into bet_activity with display fields resolved. Trades are
-- only ever inserted inside buy_shares / sell_shares, so this covers all bets
-- for both actions without touching those function bodies. trades.amount is
-- already the value to show (buy = notional, sell = net proceeds).
create or replace function public.mirror_trade_to_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug     text;
  v_question text;
  v_username text;
begin
  select slug, question into v_slug, v_question
  from public.markets where id = new.market_id;

  select username into v_username
  from public.profiles where id = new.user_id;

  insert into public.bet_activity
    (market_id, market_slug, market_title, user_id, username,
     action, outcome, amount, shares, price, created_at)
  values
    (new.market_id, v_slug, v_question, new.user_id, v_username,
     new.action, new.outcome, new.amount, new.shares, new.price, new.created_at);

  return new;
end;
$$;

create trigger trades_mirror_to_activity
  after insert on public.trades
  for each row execute function public.mirror_trade_to_activity();

-- Turn on realtime for the feed.
alter publication supabase_realtime add table public.bet_activity;
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Apply via the Supabase CLI from the repo root:

Run: `supabase db push`
Expected: the new migration `20260708000005_bet_activity` is listed as applied with no errors.

(Alternative if CLI is not linked: apply the same SQL through the Supabase MCP `apply_migration` tool with name `bet_activity`.)

- [ ] **Step 3: Verify the schema landed**

Run (psql or Supabase SQL editor):
```sql
select count(*) from public.bet_activity;
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'bet_activity';
```
Expected: first query returns `0` (table exists, empty); second returns one row (`bet_activity` is published).

- [ ] **Step 4: Verify the trigger mirrors a real bet**

Place one bet through the running app (any market, small amount) as a signed-in user, then run:
```sql
select username, action, outcome, amount, market_title
from public.bet_activity order by created_at desc limit 1;
```
Expected: one row matching the bet you just placed (correct outcome, amount, and market title).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708000005_bet_activity.sql
git commit -m "feat(db): bet_activity table + trade-mirroring trigger + realtime"
```

---

### Task 2: Types + pure helpers (`BetActivity`, `formatBetActivity`, `mergeThread`)

**Files:**
- Modify: `src/types.ts` (append the `BetActivity` interface)
- Create: `src/lib/betActivity.ts`
- Create: `src/lib/betActivity.test.ts`

**Interfaces:**
- Consumes: `Outcome` and `CommentWithAuthor` from `src/types.ts`; `formatUsd`, `formatCents` from `src/lib/format.ts`.
- Produces:
  - `interface BetActivity { id: string; market_id: string; market_slug: string; market_title: string; user_id: string; username: string | null; action: 'buy' | 'sell'; outcome: Outcome; amount: number; shares: number; price: number; created_at: string; }`
  - `formatBetActivity(a: BetActivity): string` — e.g. `"aztec bought $23.00 YES @ 55¢"`.
  - `type ThreadItem = { kind: 'comment'; at: string; comment: CommentWithAuthor } | { kind: 'trade'; at: string; activity: BetActivity }`
  - `mergeThread(comments: CommentWithAuthor[], activity: BetActivity[]): ThreadItem[]` — newest first (descending `at`).

- [ ] **Step 1: Add the `BetActivity` type**

Append to `src/types.ts` (after the `Comment` / `CommentWithAuthor` block, before `MARKET_CATEGORIES`):

```ts
// One denormalized activity row per bet — powers the live popup + comment stamps.
export interface BetActivity {
  id: string;
  market_id: string;
  market_slug: string;
  market_title: string;
  user_id: string;
  username: string | null;
  action: 'buy' | 'sell';
  outcome: Outcome;
  amount: number;
  shares: number;
  price: number;
  created_at: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/betActivity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BetActivity, CommentWithAuthor } from '../types';
import { formatBetActivity, mergeThread } from './betActivity';

function activity(over: Partial<BetActivity> = {}): BetActivity {
  return {
    id: 'a1',
    market_id: 'm1',
    market_slug: 'btc-100k',
    market_title: 'Will BTC hit $100k?',
    user_id: 'u1',
    username: 'aztec',
    action: 'buy',
    outcome: 'yes',
    amount: 23,
    shares: 42,
    price: 0.55,
    created_at: '2026-07-08T10:00:00Z',
    ...over,
  };
}

describe('formatBetActivity', () => {
  it('renders a buy as a readable sentence', () => {
    expect(formatBetActivity(activity())).toBe('aztec bought $23.00 YES @ 55¢');
  });

  it('renders a sell with the sold verb and NO outcome', () => {
    expect(
      formatBetActivity(activity({ action: 'sell', outcome: 'no', amount: 10, price: 0.4 }))
    ).toBe('aztec sold $10.00 NO @ 40¢');
  });

  it('falls back to "Someone" when username is null', () => {
    expect(formatBetActivity(activity({ username: null }))).toBe(
      'Someone bought $23.00 YES @ 55¢'
    );
  });
});

describe('mergeThread', () => {
  const comment = (id: string, at: string): CommentWithAuthor => ({
    id,
    market_id: 'm1',
    user_id: 'u9',
    body: 'nice',
    created_at: at,
    profile: { id: 'u9', username: 'bob' },
  });

  it('interleaves comments and activity newest-first', () => {
    const items = mergeThread(
      [comment('c1', '2026-07-08T10:01:00Z')],
      [
        activity({ id: 'a-old', created_at: '2026-07-08T10:00:00Z' }),
        activity({ id: 'a-new', created_at: '2026-07-08T10:02:00Z' }),
      ]
    );
    expect(items.map((i) => (i.kind === 'trade' ? i.activity.id : i.comment.id))).toEqual([
      'a-new',
      'c1',
      'a-old',
    ]);
    expect(items[0].kind).toBe('trade');
    expect(items[1].kind).toBe('comment');
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeThread([], [])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- betActivity`
Expected: FAIL — `Cannot find module './betActivity'` (or unresolved exports).

- [ ] **Step 4: Implement the helpers**

Create `src/lib/betActivity.ts`:

```ts
import type { BetActivity, CommentWithAuthor } from '../types';
import { formatCents, formatUsd } from './format';

// "aztec bought $23.00 YES @ 55¢" — used for both the popup and the stamp.
export function formatBetActivity(a: BetActivity): string {
  const who = a.username ?? 'Someone';
  const verb = a.action === 'buy' ? 'bought' : 'sold';
  return `${who} ${verb} ${formatUsd(a.amount)} ${a.outcome.toUpperCase()} @ ${formatCents(a.price)}`;
}

export type ThreadItem =
  | { kind: 'comment'; at: string; comment: CommentWithAuthor }
  | { kind: 'trade'; at: string; activity: BetActivity };

// Merge human comments and bet stamps into one list, newest first.
export function mergeThread(
  comments: CommentWithAuthor[],
  activity: BetActivity[]
): ThreadItem[] {
  const items: ThreadItem[] = [
    ...comments.map((c): ThreadItem => ({ kind: 'comment', at: c.created_at, comment: c })),
    ...activity.map((a): ThreadItem => ({ kind: 'trade', at: a.created_at, activity: a })),
  ];
  return items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- betActivity`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/betActivity.ts src/lib/betActivity.test.ts
git commit -m "feat: BetActivity type + formatBetActivity/mergeThread helpers"
```

---

### Task 3: API — fetch + realtime subscription

**Files:**
- Modify: `src/lib/api.ts` (add imports + two functions in the Comments section area)

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase.ts`), `BetActivity` type.
- Produces:
  - `getBetActivity(marketId: string, limit?: number): Promise<BetActivity[]>` — newest first.
  - `subscribeToBetActivity(onInsert: (a: BetActivity) => void): () => void` — subscribes to `bet_activity` INSERTs; returns an unsubscribe function.

- [ ] **Step 1: Add `BetActivity` to the type import**

In `src/lib/api.ts`, add `BetActivity,` to the existing type import block from `../types` (the one that already imports `Comment, CommentWithAuthor`).

- [ ] **Step 2: Add the two functions**

Insert after the `addComment` function (end of the Comments section, before the `// RPCs` divider) in `src/lib/api.ts`:

```ts
// ---------------------------------------------------------------------------
// Bet activity (live feed)
// ---------------------------------------------------------------------------

export async function getBetActivity(marketId: string, limit = 30): Promise<BetActivity[]> {
  const { data, error } = await supabase
    .from('bet_activity')
    .select('*')
    .eq('market_id', marketId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Failed to load activity');
  return (data ?? []) as BetActivity[];
}

// Subscribe to every new bet across the whole site. Returns an unsubscribe fn.
export function subscribeToBetActivity(onInsert: (a: BetActivity) => void): () => void {
  const channel = supabase
    .channel('bet-activity')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bet_activity' },
      (payload) => onInsert(payload.new as BetActivity)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds (no TS errors). `fail` and `supabase` are already imported in this file.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): getBetActivity + subscribeToBetActivity realtime"
```

---

### Task 4: Extend `useToast` with accent + link

**Files:**
- Modify: `src/hooks/useToast.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `showToast(message: string, kind?: ToastKind, opts?: { accent?: Outcome; href?: string }): void`. Backward compatible — existing 1- and 2-arg calls keep working. When `href` is set the toast is a link; `accent` adds a left color bar (`yes` = green, `no` = red).

- [ ] **Step 1: Replace the file body**

Overwrite `src/hooks/useToast.tsx`:

```tsx
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Outcome } from '../types';

type ToastKind = 'success' | 'error' | 'info';

interface ToastOpts {
  accent?: Outcome;
  href?: string;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  accent?: Outcome;
  href?: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind, opts?: ToastOpts) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;
// Cap the on-screen stack so a burst of bets can't flood the viewport.
const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info', opts: ToastOpts = {}) => {
      const id = nextId++;
      setToasts((prev) =>
        [...prev, { id, message, kind, accent: opts.accent, href: opts.href }].slice(-MAX_TOASTS)
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[min(90vw,360px)] flex-col gap-2 sm:bottom-4">
        {toasts.map((t) => {
          const base = `flex overflow-hidden rounded-xl border text-sm font-semibold shadow-lg animate-[fadeIn_0.15s_ease-out] ${
            t.kind === 'success'
              ? 'border-yes/30 bg-yes-bg text-yes'
              : t.kind === 'error'
                ? 'border-no/30 bg-no-bg text-no'
                : 'border-border-c bg-white text-text-primary'
          }`;
          const accentBar =
            t.accent === 'yes'
              ? 'bg-yes'
              : t.accent === 'no'
                ? 'bg-no'
                : '';
          const inner = (
            <>
              {accentBar && <span className={`w-1 shrink-0 ${accentBar}`} />}
              <span className="px-4 py-3">{t.message}</span>
            </>
          );
          return t.href ? (
            <Link key={t.id} to={t.href} className={`${base} hover:brightness-95`}>
              {inner}
            </Link>
          ) : (
            <div key={t.id} className={base}>
              {inner}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds. Note `ToastProvider` is mounted inside `BrowserRouter` in `App.tsx`, so `Link` has router context.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useToast.tsx
git commit -m "feat(toast): optional outcome accent bar + click-through link"
```

---

### Task 5: `BetActivityListener` — fire popups site-wide

**Files:**
- Create: `src/components/BetActivityListener.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `subscribeToBetActivity` (api), `formatBetActivity` (`src/lib/betActivity`), `useToast`, `useAuth` (`session`).
- Produces: `<BetActivityListener />` — a render-null component that shows a popup per incoming bet, skipping the current user's own bets.

- [ ] **Step 1: Create the listener component**

Create `src/components/BetActivityListener.tsx`:

```tsx
import { useEffect } from 'react';
import { subscribeToBetActivity } from '../lib/api';
import { formatBetActivity } from '../lib/betActivity';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

// Mounted once. Subscribes to every bet on the platform and shows a popup —
// except the current user's own bets, which already get a trade confirmation.
export function BetActivityListener() {
  const { session } = useAuth();
  const { showToast } = useToast();
  const myId = session?.user.id ?? null;

  useEffect(() => {
    const unsubscribe = subscribeToBetActivity((a) => {
      if (a.user_id === myId) return;
      showToast(`${formatBetActivity(a)} · ${a.market_title}`, 'info', {
        accent: a.outcome,
        href: `/market/${a.market_slug}`,
      });
    });
    return unsubscribe;
  }, [myId, showToast]);

  return null;
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

In `src/App.tsx`: add the import
```tsx
import { BetActivityListener } from './components/BetActivityListener';
```
Then, inside the `<div className="flex min-h-screen flex-col ...">` (which is inside `ToastProvider` and `AuthProvider`), add `<BetActivityListener />` right before `<Header />`:

```tsx
                    <div className="flex min-h-screen flex-col bg-bg text-text-primary">
                    <BetActivityListener />
                    <Header />
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify popups in the preview (two sessions)**

Start the dev server (preview_start). Open the app. In a second browser context (or incognito) signed in as a different user, place a bet. In the first window, confirm an outcome-colored popup appears bottom-right reading e.g. `aztec bought $5.00 YES @ 55¢ · <market title>`, and clicking it navigates to that market. Then place a bet as the *current* user and confirm NO extra "someone bet" popup appears for your own bet.

Expected: popup fires for other users' bets, is color-accented by outcome, links through, and is suppressed for your own bets.

- [ ] **Step 5: Commit**

```bash
git add src/components/BetActivityListener.tsx src/App.tsx
git commit -m "feat: site-wide live bet popups via BetActivityListener"
```

---

### Task 6: Stamp bets into the comment thread (`MarketDetail`)

**Files:**
- Modify: `src/pages/MarketDetail.tsx`

**Interfaces:**
- Consumes: `getBetActivity` (api), `mergeThread` + `formatBetActivity` (`src/lib/betActivity`), existing `comments` query.
- Produces: the Comments card renders a merged, time-sorted list of human comments and distinct trade stamps.

- [ ] **Step 1: Add imports**

In `src/pages/MarketDetail.tsx`:
- Add `getBetActivity` to the existing `../lib/api` import.
- Add `import { formatBetActivity, mergeThread } from '../lib/betActivity';`

- [ ] **Step 2: Add the bet-activity query**

Right after the existing `comments` query (the `useQuery` with `queryKey: ['comments', ...]`), add:

```tsx
  const { data: activity } = useQuery({
    queryKey: ['bet-activity', market?.id ?? null],
    queryFn: () => getBetActivity(market!.id),
    enabled: !!market,
    // Cheap poll so stamps from other users appear without a manual refresh,
    // even independent of the realtime popup channel.
    refetchInterval: 8000,
  });

  const thread = mergeThread(comments ?? [], activity ?? []);
```

- [ ] **Step 3: Render the merged thread**

Replace the comment-list block (the `{!comments || comments.length === 0 ? (...) : (<ul>...</ul>)}` region, currently around lines 323–342) with:

```tsx
            {thread.length === 0 ? (
              <p className="text-sm text-text-muted">No comments yet.</p>
            ) : (
              <ul className="space-y-4">
                {thread.map((item) =>
                  item.kind === 'comment' ? (
                    <li key={`c-${item.comment.id}`} className="flex gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6d8ac4] text-[13px] font-bold text-white">
                        {(item.comment.profile?.username || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="text-[13.5px]">
                        <span className="font-bold text-text-primary">
                          {item.comment.profile?.username || 'Anonymous'}
                        </span>
                        <span className="ml-2 text-text-faint">
                          {formatDateTime(item.comment.created_at)}
                        </span>
                        <p className="mt-0.5 leading-relaxed text-text-secondary">
                          {item.comment.body}
                        </p>
                      </div>
                    </li>
                  ) : (
                    <li
                      key={`a-${item.activity.id}`}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold ${
                        item.activity.outcome === 'yes'
                          ? 'border-yes/25 bg-yes-bg text-yes'
                          : 'border-no/25 bg-no-bg text-no'
                      }`}
                    >
                      <span>{item.activity.outcome === 'yes' ? '🟢' : '🔴'}</span>
                      <span className="flex-1">{formatBetActivity(item.activity)}</span>
                      <span className="text-text-faint">
                        {formatDateTime(item.activity.created_at)}
                      </span>
                    </li>
                  )
                )}
              </ul>
            )}
```

Note: the `Comments · {comments?.length ?? 0}` heading stays keyed to human comments only — do not change it.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Verify the stamp in the preview**

With the dev server running, open a market and place a bet. Confirm a distinct colored stamp row (🟢/🔴, e.g. `aztec bought $5.00 YES @ 55¢`) appears in the Comments card, time-ordered against any real comments, and that posting a normal comment still renders as a human comment. Confirm the `Comments · N` count reflects only human comments.

Expected: stamps and comments interleave by time; stamps are visually distinct; comment count unchanged by stamps.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MarketDetail.tsx
git commit -m "feat: stamp bets into the market comment thread"
```

---

## Self-Review

**Spec coverage:**
- Denormalized `bet_activity` single source → Task 1. ✓
- Server-side stamp for every bet (both buy + sell) → Task 1 trigger on `trades` (design refinement: a trigger replaces the "helper called from both RPCs" wording — same guarantee, no RPC-body rewrite; noted here intentionally). ✓
- RLS select-all + realtime publication → Task 1. ✓
- `getBetActivity` + `subscribeToBetActivity` + `BetActivity` type → Tasks 2, 3. ✓
- Site-wide popups, outcome accent, click-through, suppress own bets, stack cap → Tasks 4, 5. ✓
- Merge stamps into comment thread, distinct styling, `comments` untouched, count = humans only → Task 6. ✓
- Non-goals (no Activity tab, no edit/delete, no backfill, no dedup) → respected; nothing implements them. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has expected output. ✓

**Type consistency:** `BetActivity` fields (Task 2) match the SQL columns (Task 1) and the `select('*')` in `getBetActivity` (Task 3). `formatBetActivity`/`mergeThread`/`ThreadItem` signatures are consistent across Tasks 2, 5, 6. `showToast(message, kind, opts)` defined in Task 4 is called with that shape in Task 5. `Outcome` reused throughout. ✓

**Note on tests:** Only the pure helpers (Task 2) are unit-tested with Vitest; the DB trigger, realtime subscription, and React wiring are integration concerns verified via the live Supabase project and the browser preview (Tasks 1, 5, 6), which is the honest boundary for this stack.

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Logo } from './Logo';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'signin' | 'signup';
}

export function AuthModal({ open, onClose, initialTab = 'signin' }: AuthModalProps) {
  const [tab, setTab] = useState<'signin' | 'signup'>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const { signIn, signUp } = useAuth();
  const { showToast } = useToast();

  if (!open) return null;

  function reset() {
    setEmail('');
    setPassword('');
    setUsername('');
    setError(null);
    setCheckEmail(false);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'signin') {
        await signIn(email, password);
        showToast('Signed in', 'success');
        handleClose();
      } else {
        const result = await signUp(email, password, username);
        if (result.needsEmailConfirmation) {
          setCheckEmail(true);
        } else {
          showToast('Account created — welcome to Hunch', 'success');
          handleClose();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border-c bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex justify-center">
          <Logo to={false} />
        </div>

        {checkEmail ? (
          <div className="text-center">
            <h2 className="text-lg font-extrabold text-text-primary">Check your email</h2>
            <p className="mt-2 text-sm text-text-muted">
              We sent a confirmation link to <span className="text-text-primary">{email}</span>.
              Confirm your address, then sign in.
            </p>
            <button
              className="mt-5 w-full rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep"
              onClick={() => {
                setCheckEmail(false);
                setTab('signin');
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex rounded-xl bg-subtle p-1 text-sm font-bold">
              <button
                className={clsx(
                  'flex-1 rounded-lg py-2 transition',
                  tab === 'signin' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'
                )}
                onClick={() => {
                  setTab('signin');
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                className={clsx(
                  'flex-1 rounded-lg py-2 transition',
                  tab === 'signup' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'
                )}
                onClick={() => {
                  setTab('signup');
                  setError(null);
                }}
              >
                Sign up
              </button>
            </div>

            {tab === 'signup' && (
              <p className="mb-4 rounded-xl bg-teal-tint px-3.5 py-2.5 text-center text-[13px] font-bold text-teal-deep">
                Free $1,000 play-money bankroll — no card needed
              </p>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {tab === 'signup' && (
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
                />
              )}
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
              />

              {error && (
                <p className="rounded-lg border border-no/30 bg-no-bg px-3 py-2 text-xs font-medium text-no">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Please wait…' : tab === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}

        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-text-muted transition hover:text-text-primary"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

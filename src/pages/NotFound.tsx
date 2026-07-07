import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-4 py-24 text-center sm:px-7">
      <p className="text-6xl font-extrabold text-text-primary">404</p>
      <p className="mt-2 text-sm text-text-muted">This page doesn't exist.</p>
      <Link
        to="/"
        className="mt-6 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep"
      >
        Back to markets
      </Link>
    </div>
  );
}

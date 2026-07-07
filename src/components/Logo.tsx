import clsx from 'clsx';
import { Link } from 'react-router-dom';

interface LogoProps {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  to?: string | false;
}

export function Logo({ className, markClassName, textClassName, to = '/' }: LogoProps) {
  const content = (
    <>
      <span
        className={clsx(
          'grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-teal text-[15px] font-extrabold text-white',
          markClassName
        )}
      >
        h
      </span>
      <span className={clsx('text-xl font-extrabold tracking-tight text-text-primary', textClassName)}>
        hunch
      </span>
    </>
  );

  const classes = clsx('flex shrink-0 items-center gap-2', className);

  if (to === false) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <Link to={to} className={classes}>
      {content}
    </Link>
  );
}

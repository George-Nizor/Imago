import type { ButtonHTMLAttributes, ReactNode, SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'background'
  | 'beauty'
  | 'bloat'
  | 'check'
  | 'close'
  | 'copy'
  | 'download'
  | 'eraser'
  | 'eye'
  | 'eye-off'
  | 'film'
  | 'fit'
  | 'frames'
  | 'image'
  | 'layers'
  | 'next'
  | 'palette'
  | 'pause'
  | 'play'
  | 'plus'
  | 'previous'
  | 'pucker'
  | 'redo'
  | 'replace'
  | 'reload'
  | 'scissors'
  | 'select'
  | 'shuffle'
  | 'sparkle'
  | 'template'
  | 'text'
  | 'transform'
  | 'trash'
  | 'undo'
  | 'upload'
  | 'user'
  | 'warning'
  | 'warp';

const paths: Record<IconName, ReactNode> = {
  'arrow-left': <path d="m15 18-6-6 6-6" />,
  background: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 15 5-5 4 4 3-3 6 6" />
    </>
  ),
  beauty: (
    <>
      <path d="M12 3c1.2 3.2 2.8 4.8 6 6-3.2 1.2-4.8 2.8-6 6-1.2-3.2-2.8-4.8-6-6 3.2-1.2 4.8-2.8 6-6Z" />
      <path d="M19 15c.5 1.4 1.2 2.1 2.5 2.5-1.3.5-2 1.2-2.5 2.5-.5-1.3-1.2-2-2.5-2.5 1.3-.4 2-1.1 2.5-2.5Z" />
    </>
  ),
  bloat: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </>
  ),
  eraser: (
    <>
      <path d="m4 15 8-9 7 6-7 8H8l-4-5Z" />
      <path d="m9 10 6 6M12 20h8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'eye-off': (
    <>
      <path d="m4 4 16 16" />
      <path d="M10.7 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.1 2.7M6.2 7.3C3.8 9.1 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.5" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4m10 0h4M3 15h4m10 0h4" />
    </>
  ),
  fit: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </>
  ),
  frames: (
    <>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="m7 6 2-3h12v12l-4 3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m3 17 5-5 4 4 3-3 6 6" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  next: <path d="m9 5 7 7-7 7" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12h-3Z" />
      <circle cx="7.5" cy="10" r=".7" fill="currentColor" />
      <circle cx="10" cy="6.8" r=".7" fill="currentColor" />
      <circle cx="14" cy="6.5" r=".7" fill="currentColor" />
    </>
  ),
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  previous: <path d="m15 5-7 7 7 7" />,
  pucker: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m8 8 3 3m5-3-3 3m-5 5 3-3m5 3-3-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M19 12h-8a6 6 0 0 0-6 6" />
    </>
  ),
  replace: (
    <>
      <path d="M20 7h-7a4 4 0 0 0-4 4v1" />
      <path d="m17 4 3 3-3 3M4 17h7a4 4 0 0 0 4-4v-1" />
      <path d="m7 20-3-3 3-3" />
    </>
  ),
  reload: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.5 15a7 7 0 1 1-.8-7.8L20 9" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="m8.5 8.5 11 7.5M8.5 15.5 19.5 8" />
    </>
  ),
  select: (
    <>
      <path d="m5 3 13 9-6 1.5L9 20 5 3Z" />
    </>
  ),
  shuffle: (
    <>
      <path d="M4 7h3c4 0 6 10 10 10h3" />
      <path d="m17 14 3 3-3 3M4 17h3c1.2 0 2.2-.8 3.1-2M14 7c.9 0 1.8 0 3 0h3" />
      <path d="m17 4 3 3-3 3" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 2c1.1 3.2 2.8 4.9 6 6-3.2 1.1-4.9 2.8-6 6-1.1-3.2-2.8-4.9-6-6 3.2-1.1 4.9-2.8 6-6Z" />
      <path d="M19 14c.5 1.4 1.2 2.1 2.5 2.5-1.3.5-2 1.2-2.5 2.5-.5-1.3-1.2-2-2.5-2.5 1.3-.4 2-1.1 2.5-2.5Z" />
    </>
  ),
  template: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M10 10v10" />
    </>
  ),
  text: (
    <>
      <path d="M5 5h14M12 5v14M8 19h8" />
    </>
  ),
  transform: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <path d="m8 8 8 8m0-8-8 8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </>
  ),
  undo: (
    <>
      <path d="m9 7-5 5 5 5" />
      <path d="M5 12h8a6 6 0 0 1 6 6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M5 15v4h14v-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.5h.01" />
    </>
  ),
  warp: (
    <>
      <path d="M4 7c4-4 12 4 16 0M4 12c4-4 12 4 16 0M4 17c4-4 12 4 16 0" />
    </>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  pressed?: boolean;
}

export function IconButton({
  icon,
  label,
  pressed,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-tooltip={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

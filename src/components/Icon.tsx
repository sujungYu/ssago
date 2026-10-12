import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  phone: <path d="M5 4h4l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  warn: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  find: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.5 2.2 3.5 5.2" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14.5h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z" />,
  screen: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 9h16M4 14h16M9 4v16M15 4v16" /></>,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  door: <><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" /><path d="M4 21h16M14.5 12h.01" /></>,
  drawer: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 12h16M10 8h4M10 16h4" /></>,
  window: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M12 3v18M4 12h16" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  shelf: <><path d="M4 8h16M4 16h16" /><path d="M7 8v-3M17 8v-3M7 16v-3M17 16v-3" /></>,
  tool: <path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L21 13l-8 8a2.1 2.1 0 0 1-3-3l8-8-1.5-3.5z" />,
  seal: <><path d="M4 18h16M6 18v-5h12v5" /><path d="M9 13V7a3 3 0 0 1 6 0v6" /></>,
  filter: <path d="M4 5h16l-6 7.5V18l-4 2v-7.5L4 5z" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></>,
  box: <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>,
  swap: <><path d="M4 8h14l-3-3M20 16H6l3 3" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M4 4l16 16" /><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.5 7.6C4 9.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" /><path d="M10 10a3 3 0 0 0 4 4" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
};

export function Icon({ name, size = 22, label }: { name: keyof typeof P | string; size?: number; label?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false"
    >
      {P[name] ?? P.more}
    </svg>
  );
}

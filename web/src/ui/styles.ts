import type { CSSProperties } from 'react';

/** Secondary (outline glass) button, ≥ 44px tall. */
export const secondaryBtn: CSSProperties = {
  alignSelf: 'stretch', minHeight: 52, borderRadius: 26, padding: '0 18px',
  border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.08)',
  color: '#FFFFFF', fontSize: 16, fontWeight: 700,
};

/** Inline text link button with a 44px touch target. */
export const linkBtn: CSSProperties = {
  minHeight: 44, padding: '0 8px', border: 0, background: 'transparent',
  color: '#8FD8F2', fontSize: 14, fontWeight: 600, textDecoration: 'underline',
};

export const errorText: CSSProperties = { fontSize: 13, color: '#FF8E8E', textAlign: 'center' };
export const noticeText: CSSProperties = { fontSize: 13, color: '#DCE8F1', textAlign: 'center' };
export const mutedText: CSSProperties = { fontSize: 13, color: '#C6D8E6', textAlign: 'center' };

/** Big glass icon tile used on the first-run screens. */
export const iconTile: CSSProperties = { width: 76, height: 76, borderRadius: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const screenTitle: CSSProperties = { fontFamily: "'Inter Tight', sans-serif", fontSize: 28, fontWeight: 800, textAlign: 'center', lineHeight: 1.15 };
export const screenCol: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#FFFFFF', minHeight: 'calc(100vh - 140px)' };

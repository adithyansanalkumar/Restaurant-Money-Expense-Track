import type { ElementType, HTMLAttributes, ReactNode } from 'react';

type GlassProps = {
  as?: ElementType;
  className?: string;
  strong?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'className'>;

export function Glass({ as: Tag = 'div', className = '', strong = false, children, ...rest }: GlassProps) {
  const cls = [strong ? 'glass-bar' : 'glass', className].filter(Boolean).join(' ');
  return <Tag className={cls} {...rest}>{children}</Tag>;
}

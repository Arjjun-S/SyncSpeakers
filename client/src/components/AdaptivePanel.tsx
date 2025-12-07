import type { CSSProperties, ReactNode } from 'react';

interface AdaptivePanelProps {
  children: ReactNode;
  maxWidth?: number;
  align?: 'start' | 'center';
  gap?: number;
  className?: string;
}

/**
 * Layout helper to keep panels aligned and readable on smaller screens.
 * Applies a max width, responsive padding, and optional centering.
 */
export function AdaptivePanel({
  children,
  maxWidth = 1080,
  align = 'start',
  gap = 16,
  className = ''
}: AdaptivePanelProps) {
  const classes = [
    'adaptive-panel',
    align === 'center' ? 'adaptive-panel-center' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  const style: CSSProperties = {
    // Custom properties keep the CSS file simple and composable.
    ['--adaptive-max' as string]: `${maxWidth}px`,
    ['--adaptive-gap' as string]: `${gap}px`
  };

  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}

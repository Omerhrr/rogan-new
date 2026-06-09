/**
 * Rogan Live v3 — Mobile Detection Hook
 */

import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}

export function useLayoutMode(): 'mobile' | 'desktop' {
  return useIsMobile(960) ? 'mobile' : 'desktop';
}

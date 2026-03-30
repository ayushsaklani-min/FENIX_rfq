import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const useLenis = (enabled = true) => {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('lenis');
        document.documentElement.classList.remove('lenis-smooth');
        document.body.classList.remove('lenis');
        document.body.classList.remove('lenis-smooth');
      }
      lenisRef.current?.destroy();
      lenisRef.current = null;
      return;
    }

    // Initialize Lenis with smooth scrolling
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 2,
    });

    lenisRef.current = lenis;

    // Connect Lenis to GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    const raf = (time: number) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(raf);

    gsap.ticker.lagSmoothing(0);

    // Cleanup
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [enabled]);

  return lenisRef;
};

export default useLenis;

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { howItWorksConfig } from '@/lib/premiumLandingConfig';

export function HowItWorksCarousel() {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [direction, setDirection] = useState<'next' | 'prev'>('next');
    const sectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -10% 0px' }
        );

        const elements = sectionRef.current?.querySelectorAll('.fade-up, .slide-in-left, .slide-in-right');
        elements?.forEach((element) => observer.observe(element));

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            goToSlide((currentSlide + 1) % howItWorksConfig.slides.length, 'next');
        }, 6000);

        return () => window.clearInterval(timer);
    }, [currentSlide]);

    const goToSlide = (index: number, nextDirection: 'next' | 'prev' = 'next') => {
        if (isAnimating) return;
        setIsAnimating(true);
        setDirection(nextDirection);
        setCurrentSlide(index);
        window.setTimeout(() => setIsAnimating(false), 600);
    };

    const nextSlide = () => goToSlide((currentSlide + 1) % howItWorksConfig.slides.length, 'next');
    const previousSlide = () => goToSlide((currentSlide - 1 + howItWorksConfig.slides.length) % howItWorksConfig.slides.length, 'prev');

    return (
        <section id="how-it-works" ref={sectionRef} className="section-padding relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03]">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'linear-gradient(45deg, rgba(16,185,129,0.35) 25%, transparent 25%), linear-gradient(-45deg, rgba(16,185,129,0.35) 25%, transparent 25%)',
                        backgroundSize: '60px 60px',
                        backgroundPosition: '0 0, 30px 0',
                    }}
                />
            </div>

            <div className="container-custom relative">
                <div className="fade-up mb-12 text-center">
                    <span className="premium-script mb-2 block text-3xl text-emerald-300">{howItWorksConfig.scriptText}</span>
                    <span className="mb-4 block text-xs uppercase tracking-[0.2em] text-emerald-500">{howItWorksConfig.subtitle}</span>
                    <h2 className="premium-heading text-4xl text-white sm:text-5xl lg:text-6xl">{howItWorksConfig.mainTitle}</h2>
                </div>

                <div className="slide-in-left" style={{ transitionDelay: '0.1s' }}>
                    <div className="grid items-stretch gap-8 lg:grid-cols-2 lg:gap-0">
                        <div className="relative aspect-[4/3] overflow-hidden rounded-lg lg:min-h-[500px] lg:rounded-r-none lg:rounded-l-lg">
                            {howItWorksConfig.slides.map((slide, index) => (
                                <div
                                    key={slide.title}
                                    className={`absolute inset-0 transition-all duration-[600ms] ease-out ${
                                        index === currentSlide
                                            ? 'z-10 scale-100 opacity-100'
                                            : index === (currentSlide - 1 + howItWorksConfig.slides.length) % howItWorksConfig.slides.length && direction === 'next'
                                              ? '-translate-x-full opacity-0'
                                              : index === (currentSlide + 1) % howItWorksConfig.slides.length && direction === 'prev'
                                                ? 'translate-x-full opacity-0'
                                                : 'opacity-0'
                                    }`}
                                >
                                    <img src={slide.image} alt={slide.title} loading="lazy" className={`h-full w-full object-cover ${index === currentSlide ? 'kenburns' : ''}`} />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                                </div>
                            ))}

                            <div className="absolute bottom-6 left-6 z-20 flex gap-3">
                                <button
                                    onClick={previousSlide}
                                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-500"
                                    aria-label="Previous process slide"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </button>
                                <button
                                    onClick={nextSlide}
                                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-500"
                                    aria-label="Next process slide"
                                >
                                    <ChevronRight className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="absolute bottom-6 right-6 z-20 flex gap-2">
                                {howItWorksConfig.slides.map((slide, index) => (
                                    <button
                                        key={slide.title}
                                        onClick={() => goToSlide(index, index > currentSlide ? 'next' : 'prev')}
                                        className={`h-1 rounded-full transition-all duration-300 ${
                                            index === currentSlide ? 'w-8 bg-emerald-500' : 'w-4 bg-white/40 hover:bg-white/60'
                                        }`}
                                        aria-label={`Go to ${slide.title}`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="relative flex flex-col justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5 p-8 lg:rounded-l-none lg:border-l-0 lg:p-12">
                            {howItWorksConfig.slides.map((slide, index) => (
                                <div
                                    key={slide.title}
                                    className={`transition-all duration-500 ${index === currentSlide ? 'translate-y-0 opacity-100' : 'absolute translate-y-4 opacity-0'}`}
                                    style={{ display: index === currentSlide ? 'block' : 'none' }}
                                >
                                    <div className="mb-4 flex items-center gap-2 text-sm text-emerald-500">
                                        <MapPin className="h-4 w-4" />
                                        <span>{howItWorksConfig.locationTag}</span>
                                    </div>

                                    <h3 className="premium-heading mb-2 text-3xl text-white sm:text-4xl">{slide.title}</h3>
                                    <p className="mb-6 text-lg text-white/70">{slide.subtitle}</p>

                                    <div className="mb-6 flex items-baseline gap-2">
                                        <span className="premium-heading text-5xl text-emerald-500 lg:text-6xl">{slide.area}</span>
                                        <span className="text-lg text-white/70">{slide.unit}</span>
                                    </div>

                                    <p className="leading-relaxed text-white/75">{slide.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="fade-up mt-8 flex justify-center lg:justify-start" style={{ transitionDelay: '0.2s' }}>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="premium-heading text-2xl text-emerald-500">{String(currentSlide + 1).padStart(2, '0')}</span>
                        <div className="h-px w-12 bg-white/30" />
                        <span className="text-white/60">{String(howItWorksConfig.slides.length).padStart(2, '0')}</span>
                    </div>
                </div>
            </div>
        </section>
    );
}

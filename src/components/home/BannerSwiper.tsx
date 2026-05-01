import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LazyImage from '@/components/shared/LazyImage';

interface Banner {
  id: string;
  imageUrl: string;
  title?: string;
  link?: string;
}

interface BannerSwiperProps {
  banners: Banner[];
  autoplayInterval?: number;
}

const BannerSwiper: React.FC<BannerSwiperProps> = ({
  banners,
  autoplayInterval = 3000,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const navigate = useNavigate();
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const goToSlide = useCallback(
    (index: number) => {
      setCurrentIndex((index + banners.length) % banners.length);
    },
    [banners.length]
  );

  const handleSlideClick = useCallback(
    (banner: Banner) => {
      if (banner.link) {
        navigate(banner.link);
      }
    },
    [navigate]
  );

  const handleSlideKeyDown = useCallback(
    (e: React.KeyboardEvent, banner: Banner) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSlideClick(banner);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToSlide(currentIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToSlide(currentIndex + 1);
      }
    },
    [handleSlideClick, goToSlide, currentIndex]
  );

  const handleDotKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToSlide(index);
      }
    },
    [goToSlide]
  );

  // Autoplay
  useEffect(() => {
    if (banners.length <= 1) return;

    autoplayRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length);
    }, autoplayInterval);

    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
    };
  }, [banners.length, autoplayInterval]);

  // Pause autoplay on focus within the swiper
  const handleFocus = useCallback(() => {
    if (autoplayRef.current) clearInterval(autoplayRef.current);
  }, []);

  const handleBlur = useCallback(() => {
    if (banners.length <= 1) return;
    autoplayRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length);
    }, autoplayInterval);
  }, [banners.length, autoplayInterval]);

  if (!banners.length) {
    return (
      <div
        className="banner-swiper banner-swiper--empty"
        role="region"
        aria-label="Banner carousel"
        aria-roledescription="carousel"
      >
        <div className="banner-swiper__placeholder">No banners available</div>
      </div>
    );
  }

  return (
    <div
      className="banner-swiper"
      role="region"
      aria-label="Banner carousel"
      aria-roledescription="carousel"
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="banner-swiper__track" role="group" aria-label="Banner slides">
        {banners.map((banner, index) => {
          const isActive = index === currentIndex;
          return (
            <div
              key={banner.id}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              className={`banner-swiper__slide ${isActive ? 'banner-swiper__slide--active' : ''}`}
              role="link"
              tabIndex={isActive ? 0 : -1}
              aria-label={`Banner ${index + 1}: ${banner.title || 'promotion'}`}
              aria-roledescription="slide"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => handleSlideClick(banner)}
              onKeyDown={(e) => handleSlideKeyDown(e, banner)}
              style={{
                transform: `translateX(${(index - currentIndex) * 100}%)`,
              }}
            >
              <LazyImage
                src={banner.imageUrl}
                alt={banner.title || `Banner ${index + 1}`}
                className="banner-swiper__image"
              />
            </div>
          );
        })}
      </div>

      {/* Dot indicators — maintain existing keyboard support */}
      {banners.length > 1 && (
        <div
          className="banner-swiper__dots"
          role="tablist"
          aria-label="Banner navigation"
        >
          {banners.map((banner, index) => (
            <button
              key={banner.id}
              className={`banner-swiper__dot ${index === currentIndex ? 'banner-swiper__dot--active' : ''}`}
              role="tab"
              tabIndex={0}
              aria-selected={index === currentIndex}
              aria-label={`Go to banner ${index + 1}`}
              onClick={() => goToSlide(index)}
              onKeyDown={(e) => handleDotKeyDown(e, index)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default BannerSwiper;

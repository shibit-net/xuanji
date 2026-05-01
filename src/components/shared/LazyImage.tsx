import React, { useState, useRef, useEffect } from 'react';

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
  width?: number | string;
  height?: number | string;
}

const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt = '',
  className = '',
  width,
  height,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      {
        rootMargin: '200px',
        threshold: 0.01,
      }
    );

    observerRef.current.observe(el);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setIsError(true);
  };

  // Loading state: show placeholder skeleton
  if (!isInView) {
    return (
      <div
        ref={imgRef}
        className={`lazy-image lazy-image--placeholder ${className}`}
        style={{ width, height }}
        aria-hidden="true"
      />
    );
  }

  // Error state: show broken image indicator
  if (isError) {
    return (
      <div
        ref={imgRef}
        className={`lazy-image lazy-image--error ${className}`}
        style={{ width, height }}
        role="img"
        aria-label={`${alt || 'Image'} - failed to load`}
      >
        <span
          className="lazy-image__error-icon"
          role="img"
          aria-label={alt || 'Image failed to load'}
        >
          🖼
        </span>
        {alt && (
          <span className="lazy-image__error-text">{alt}</span>
        )}
      </div>
    );
  }

  // Loading spinner state (in view but not yet loaded)
  if (!isLoaded) {
    return (
      <div
        ref={imgRef}
        className={`lazy-image lazy-image--loading ${className}`}
        style={{ width, height }}
      >
        <div className="lazy-image__spinner" aria-hidden="true" />
        <img
          src={src}
          alt={alt || ''}
          className="lazy-image__img lazy-image__img--hidden"
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    );
  }

  // Loaded state: show the image
  return (
    <div
      ref={imgRef}
      className={`lazy-image lazy-image--loaded ${className}`}
      style={{ width, height }}
    >
      <img
        src={src}
        alt={alt || ''}
        className="lazy-image__img"
        onError={handleError}
      />
    </div>
  );
};

export default LazyImage;

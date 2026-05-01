import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LazyImage from '@/components/shared/LazyImage';

interface FlashSaleProduct {
  id: string;
  name: string;
  imageUrl: string;
  originalPrice: number;
  price: number;
  stock: number;
}

interface FlashSaleData {
  endTime: number;
  products: FlashSaleProduct[];
}

interface FlashSaleProps {
  sale: FlashSaleData;
}

// ---- useCountdown hook (extracted per architect's plan) ----
function useCountdown(targetTime: number) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const diff = targetTime - Date.now();
    return diff > 0 ? diff : 0;
  });

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        setTimeLeft(0);
        clearInterval(timer);
      } else {
        setTimeLeft(diff);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTime, timeLeft]);

  const isExpired = timeLeft <= 0;
  const totalSeconds = Math.floor(timeLeft / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { hours, minutes, seconds, isExpired };
}

// ---- Countdown display sub-component (React.memo to avoid parent re-renders) ----
const FlashSaleCountdown = React.memo(({ targetTime }: { targetTime: number }) => {
  const { hours, minutes, seconds, isExpired } = useCountdown(targetTime);

  return (
    <div
      className="flash-sale__countdown"
      aria-live="polite"
      aria-label="Flash sale countdown"
      role="timer"
      aria-atomic="true"
    >
      {isExpired ? (
        <span className="flash-sale__countdown--expired">Sale ended</span>
      ) : (
        <span>
          Ends in:{' '}
          <span className="flash-sale__time-block">
            {String(hours).padStart(2, '0')}
          </span>
          :
          <span className="flash-sale__time-block">
            {String(minutes).padStart(2, '0')}
          </span>
          :
          <span className="flash-sale__time-block">
            {String(seconds).padStart(2, '0')}
          </span>
        </span>
      )}
    </div>
  );
});

FlashSaleCountdown.displayName = 'FlashSaleCountdown';

// ---- Product item with keyboard accessibility ----
interface ProductItemProps {
  product: FlashSaleProduct;
  onNavigate: (id: string) => void;
}

const ProductItem = React.memo(({ product, onNavigate }: ProductItemProps) => {
  const handleClick = useCallback(() => {
    onNavigate(product.id);
  }, [onNavigate, product.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNavigate(product.id);
      }
    },
    [onNavigate, product.id]
  );

  const discountPercent = Math.round(
    ((product.originalPrice - product.price) / product.originalPrice) * 100
  );

  return (
    <div
      className="flash-sale__product"
      role="button"
      tabIndex={0}
      aria-label={`Flash sale: ${product.name}, now $${product.price}, ${discountPercent}% off`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="flash-sale__product-image">
        <LazyImage src={product.imageUrl} alt={product.name} />
        <span className="flash-sale__discount-badge" aria-label={`${discountPercent}% off`}>
          -{discountPercent}%
        </span>
      </div>
      <div className="flash-sale__product-info">
        <p className="flash-sale__product-name">{product.name}</p>
        <div className="flash-sale__product-pricing">
          <span className="flash-sale__product-price">${product.price}</span>
          <span className="flash-sale__product-original">${product.originalPrice}</span>
        </div>
        {product.stock <= 10 && product.stock > 0 && (
          <span className="flash-sale__low-stock" aria-live="polite">
            Only {product.stock} left!
          </span>
        )}
      </div>
    </div>
  );
});

ProductItem.displayName = 'ProductItem';

// ---- Main FlashSale component ----
const FlashSale: React.FC<FlashSaleProps> = ({ sale }) => {
  const navigate = useNavigate();

  const handleNavigate = useCallback(
    (productId: string) => {
      navigate(`/product/${productId}`);
    },
    [navigate]
  );

  return (
    <section className="flash-sale" aria-label="Flash sale section">
      <div className="flash-sale__header">
        <h2 className="flash-sale__title">Flash Sale</h2>
        <FlashSaleCountdown targetTime={sale.endTime} />
      </div>

      <div className="flash-sale__products" role="list" aria-label="Flash sale products">
        {sale.products.map((product) => (
          <div key={product.id} role="listitem">
            <ProductItem product={product} onNavigate={handleNavigate} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default FlashSale;

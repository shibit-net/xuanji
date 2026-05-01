import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '@/store/CartContext';

interface TabConfig {
  path: string;
  emoji: string;
  label: string;
}

const TABS: TabConfig[] = [
  { path: '/', emoji: '🏠', label: 'Home' },
  { path: '/search', emoji: '🔍', label: 'Search' },
  { path: '/cart', emoji: '🛒', label: 'Cart' },
  { path: '/profile', emoji: '👤', label: 'Profile' },
];

const TabBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useCart();

  const cartCount = state.items.reduce((sum, item) => sum + item.quantity, 0);

  const handleKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(path);
    }
  };

  return (
    <nav className="tab-bar" role="navigation" aria-label="Main navigation">
      {TABS.map((tab) => {
        const isActive = location.pathname === tab.path;
        const isCartTab = tab.path === '/cart';

        return (
          <button
            key={tab.path}
            className={`tab-bar__item ${isActive ? 'tab-bar__item--active' : ''}`}
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            tabIndex={0}
            onClick={() => navigate(tab.path)}
            onKeyDown={(e) => handleKeyDown(e, tab.path)}
          >
            <span className="tab-bar__icon" role="img" aria-label={tab.label}>
              {tab.emoji}
            </span>
            <span className="tab-bar__label" aria-hidden="true">
              {tab.label}
            </span>

            {isCartTab && (
              <span
                className="tab-bar__badge-wrapper"
                aria-live="polite"
                aria-label={`Cart: ${cartCount} items`}
              >
                {cartCount > 0 && (
                  <span
                    className="tab-bar__badge"
                    aria-hidden="true"
                  >
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};

export default TabBar;

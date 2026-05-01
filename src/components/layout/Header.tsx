import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
}

const Header: React.FC<HeaderProps> = ({
  title = 'Shop',
  showBack = false,
}) => {
  const [isSearchMode, setIsSearchMode] = useState(false);
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const toggleSearchMode = useCallback(() => {
    setIsSearchMode((prev) => !prev);
  }, []);

  const handleSearchButtonKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSearchMode();
      }
    },
    [toggleSearchMode]
  );

  return (
    <header className="header" role="banner">
      <div className="header__content">
        {showBack && (
          <button
            className="header__back-btn"
            onClick={handleBack}
            aria-label="Go back"
          >
            <span aria-hidden="true">←</span>
          </button>
        )}

        {isSearchMode ? (
          /* Search mode: full search input region */
          <div className="header__search-region" role="search" aria-label="Search products">
            <input
              type="search"
              className="header__search-input"
              placeholder="Search products..."
              aria-label="Search products"
              autoFocus
              onBlur={() => {
                // Delay close so click on results registers
                setTimeout(() => setIsSearchMode(false), 200);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsSearchMode(false);
                }
              }}
            />
            <button
              className="header__search-close"
              onClick={toggleSearchMode}
              aria-label="Close search"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        ) : (
          /* Normal mode: title + search trigger button */
          <>
            <h1 className="header__title">{title}</h1>
            <button
              className="header__search-trigger"
              onClick={toggleSearchMode}
              onKeyDown={handleSearchButtonKeyDown}
              aria-label="Open search"
              tabIndex={0}
            >
              <span role="img" aria-hidden="true">
                🔍
              </span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};

export default Header;

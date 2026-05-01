import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface SearchResult {
  id: string;
  name: string;
  type?: 'product' | 'category';
}

interface SearchBarProps {
  placeholder?: string;
  className?: string;
  onSearch?: (query: string) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Search products...',
  className = '',
  onSearch,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mock search — in production, replace with API call
  const fetchResults = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    // Simulated search delay
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Mock results — replace with actual API
    const mockResults: SearchResult[] = [
      { id: '1', name: `${searchQuery} - Product A`, type: 'product' },
      { id: '2', name: `${searchQuery} - Product B`, type: 'product' },
      { id: '3', name: `${searchQuery} - Category`, type: 'category' },
    ];
    setResults(mockResults);
    setIsOpen(mockResults.length > 0);
    setActiveIndex(-1);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchResults(value);
      }, 300);
    },
    [fetchResults]
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setIsOpen(false);
      setQuery(result.name);
      setActiveIndex(-1);
      if (result.type === 'product') {
        navigate(`/product/${result.id}`);
      } else {
        navigate(`/category/${result.id}`);
      }
      onSearch?.(result.name);
    },
    [navigate, onSearch]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        handleSelect(results[activeIndex]);
      } else if (query.trim()) {
        navigate(`/search?q=${encodeURIComponent(query)}`);
        setIsOpen(false);
        onSearch?.(query);
      }
    },
    [activeIndex, results, query, navigate, onSearch, handleSelect]
  );

  // Keyboard handling for the entire search component
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev < results.length - 1 ? prev + 1 : 0;
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => {
            const next = prev > 0 ? prev - 1 : results.length - 1;
            return next;
          });
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setActiveIndex(-1);
          inputRef.current?.blur();
          break;
        case 'Enter':
          // Handled by form onSubmit, but also handle here for dropdown selection
          if (isOpen && activeIndex >= 0) {
            e.preventDefault();
            handleSelect(results[activeIndex]);
          }
          break;
      }
    },
    [results, activeIndex, isOpen, handleSelect]
  );

  // Scroll active result into view
  useEffect(() => {
    if (activeIndex >= 0 && resultsListRef.current) {
      const activeItem = resultsListRef.current.querySelector(
        `#search-result-${activeIndex}`
      ) as HTMLElement | null;
      activeItem?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Close results on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        resultsListRef.current &&
        !resultsListRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`search-bar ${className}`} role="search" aria-label="Search products">
      <form onSubmit={handleSubmit} className="search-bar__form">
        <input
          ref={inputRef}
          type="search"
          className="search-bar__input"
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          aria-label="Search products"
          aria-autocomplete="list"
          aria-controls="search-results-list"
          aria-expanded={isOpen}
          aria-activedescendant={
            isOpen && activeIndex >= 0
              ? `search-result-${activeIndex}`
              : undefined
          }
          role="combobox"
        />
        <button
          type="submit"
          className="search-bar__submit"
          aria-label="Submit search"
        >
          <span role="img" aria-hidden="true">
            🔍
          </span>
        </button>
      </form>

      {isOpen && results.length > 0 && (
        <ul
          ref={resultsListRef}
          id="search-results-list"
          className="search-bar__results"
          role="listbox"
          aria-label="Search results"
        >
          {results.map((result, index) => (
            <li
              key={result.id}
              id={`search-result-${index}`}
              className={`search-bar__result-item ${
                index === activeIndex ? 'search-bar__result-item--active' : ''
              }`}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="search-bar__result-icon" aria-hidden="true">
                {result.type === 'product' ? '📦' : '📁'}
              </span>
              <span className="search-bar__result-name">{result.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchBar;

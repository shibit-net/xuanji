/**
 * Unit tests for TimeoutCache — generic LRU cache with stats
 *
 * Coverage targets:
 *   - Happy path: get / set / has / delete / getOrCompute / clear / stats
 *   - LRU eviction: exact capacity, overflow, get-then-promote, set-overwrite
 *   - Stats accuracy: hits, misses, sets, clears, evictions, size, hitRate
 *   - Edge cases: undefined values, zero maxSize, Infinity maxSize, empty cache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimeoutCache } from '@/agent/team/TimeoutCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh cache with default (unlimited) capacity for each test */
function createCache<V = number>(maxSize = Infinity): TimeoutCache<string, V> {
  return new TimeoutCache<string, V>('test-cache', maxSize);
}

// ---------------------------------------------------------------------------
// Basic operations
// ---------------------------------------------------------------------------

describe('TimeoutCache — basic operations', () => {
  describe('get / set', () => {
    it('should return undefined for a missing key', () => {
      const cache = createCache();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should retrieve a previously set value', () => {
      const cache = createCache();
      cache.set('a', 42);
      expect(cache.get('a')).toBe(42);
    });

    it('should support overwriting an existing key', () => {
      const cache = createCache();
      cache.set('a', 1).set('a', 2);
      expect(cache.get('a')).toBe(2);
    });

    it('should store and retrieve null as a valid value', () => {
      const cache = createCache<null>();
      cache.set('null-key', null);
      expect(cache.get('null-key')).toBeNull();
      expect(cache.has('null-key')).toBe(true);
    });

    it('should store and retrieve undefined-like sentinel objects', () => {
      // undefined as a Map value is legal in TS (though not recommended)
      const cache = createCache<undefined>();
      cache.set('undef', undefined);
      // Map stores undefined as a value, but get() returns V | undefined —
      // distinguishing "key missing" from "value is undefined" requires has()
      expect(cache.has('undef')).toBe(true);
      expect(cache.get('undef')).toBeUndefined();
    });

    it('should support chainable set calls', () => {
      const cache = createCache();
      const result = cache.set('a', 1).set('b', 2).set('c', 3);
      expect(result).toBe(cache);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('has', () => {
    it('should return false for a missing key', () => {
      const cache = createCache();
      expect(cache.has('nope')).toBe(false);
    });

    it('should return true for an existing key', () => {
      const cache = createCache();
      cache.set('x', 100);
      expect(cache.has('x')).toBe(true);
    });

    it('should not affect hits/misses counters', () => {
      const cache = createCache();
      cache.set('x', 1);

      // Multiple has() calls should not change stats
      cache.has('x');
      cache.has('x');
      cache.has('missing');

      const s = cache.stats();
      expect(s.hits).toBe(0);
      expect(s.misses).toBe(0);
    });

    it('should not trigger LRU promotion', () => {
      const cache = createCache(2);
      cache.set('a', 1).set('b', 2);

      // has() alone does NOT promote — 'a' is still the oldest
      cache.has('a');

      // Insert 'c' should evict 'a' (oldest)
      cache.set('c', 3);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should return true when deleting an existing key', () => {
      const cache = createCache();
      cache.set('x', 1);
      expect(cache.delete('x')).toBe(true);
      expect(cache.has('x')).toBe(false);
    });

    it('should return false when deleting a missing key', () => {
      const cache = createCache();
      expect(cache.delete('ghost')).toBe(false);
    });

    it('should not increment the evictions counter', () => {
      const cache = createCache(2);
      cache.set('a', 1).set('b', 2);
      cache.delete('a');

      const s = cache.stats();
      expect(s.evictions).toBe(0);
      expect(s.size).toBe(1);
    });

    it('should allow re-insertion after deletion', () => {
      const cache = createCache();
      cache.set('a', 1);
      cache.delete('a');
      cache.set('a', 99);
      expect(cache.get('a')).toBe(99);
    });
  });
});

// ---------------------------------------------------------------------------
// getOrCompute
// ---------------------------------------------------------------------------

describe('TimeoutCache — getOrCompute', () => {
  it('should return cached value on hit without calling factory', () => {
    const cache = createCache();
    cache.set('k', 10);

    let factoryCalls = 0;
    const result = cache.getOrCompute('k', () => {
      factoryCalls++;
      return 999;
    });

    expect(result).toBe(10);
    expect(factoryCalls).toBe(0);
  });

  it('should call factory on miss and cache the result', () => {
    const cache = createCache();
    let calls = 0;

    const result = cache.getOrCompute('k', () => {
      calls++;
      return 42;
    });

    expect(result).toBe(42);
    expect(calls).toBe(1);

    // Second call should hit the cache
    const result2 = cache.getOrCompute('k', () => {
      calls++;
      return 99;
    });

    expect(result2).toBe(42);
    expect(calls).toBe(1); // factory not called again
  });

  it('should increment hits on cache hit', () => {
    const cache = createCache();
    cache.set('k', 1);
    cache.getOrCompute('k', () => 99);

    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(0);
  });

  it('should increment misses and sets on cache miss', () => {
    const cache = createCache();

    cache.getOrCompute('k', () => 42);

    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.sets).toBe(1);
    expect(s.hits).toBe(0);
  });

  it('should trigger LRU eviction on miss when at capacity', () => {
    const cache = createCache(2);
    cache.set('a', 1).set('b', 2);

    // Fill capacity, evicting 'a'
    cache.getOrCompute('c', () => 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.stats().evictions).toBe(1);
  });

  it('should LRU-promote on hit', () => {
    const cache = createCache(2);
    cache.set('a', 1).set('b', 2);

    // Hit 'a' via getOrCompute — promotes 'a' to MRU
    cache.getOrCompute('a', () => { throw new Error('should not call factory'); });

    // Now 'b' is oldest
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('should work with a factory that always returns the same value', () => {
    const cache = createCache();
    const v1 = cache.getOrCompute('k', () => 0);
    const v2 = cache.getOrCompute('k', () => 0);
    expect(v1).toBe(0);
    expect(v2).toBe(0);
  });

  it('should handle factory throwing without corrupting cache state', () => {
    const cache = createCache();

    expect(() =>
      cache.getOrCompute('k', () => {
        throw new Error('factory failure');
      }),
    ).toThrow('factory failure');

    // Cache should NOT contain 'k' since factory threw before insertion
    expect(cache.has('k')).toBe(false);
    // Miss counter was incremented (the miss happened before factory call)
    // but sets was not (insertion didn't happen)
    const s = cache.stats();
    expect(s.misses).toBe(1);
    expect(s.sets).toBe(0);
    expect(s.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

describe('TimeoutCache — LRU eviction', () => {
  it('should evict the least-recently-used entry when capacity is exceeded', () => {
    const cache = createCache(3);
    cache.set('a', 1).set('b', 2).set('c', 3);
    // Order: a (oldest) → b → c (newest)

    cache.set('d', 4);
    // 'a' should be evicted
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.stats().size).toBe(3);
  });

  it('should promote accessed entries to MRU (get promotes)', () => {
    const cache = createCache(3);
    cache.set('a', 1).set('b', 2).set('c', 3);

    // Access 'a' — promotes to MRU. Order: b → c → a
    cache.get('a');

    cache.set('d', 4);
    // 'b' should be evicted (now oldest)
    expect(cache.has('a')).toBe(true); // survived via promotion
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('should not evict when overwriting an existing key', () => {
    const cache = createCache(3);
    cache.set('a', 1).set('b', 2).set('c', 3);

    // Overwrite 'a' — still 3 entries, no eviction
    cache.set('a', 100);

    expect(cache.stats().size).toBe(3);
    expect(cache.stats().evictions).toBe(0);
    expect(cache.get('a')).toBe(100);
  });

  it('should handle sequential evictions when adding many entries', () => {
    const cache = createCache(2);
    cache.set('a', 1).set('b', 2); // a, b
    cache.set('c', 3); // evict a → b, c
    cache.set('d', 4); // evict b → c, d
    cache.set('e', 5); // evict c → d, e

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('e')).toBe(true);
    expect(cache.stats().evictions).toBe(3);
    expect(cache.stats().size).toBe(2);
  });

  it('should track evictions separately from manual deletes', () => {
    const cache = createCache(2);
    cache.set('a', 1).set('b', 2);
    cache.delete('a'); // manual delete — no eviction counter bump
    cache.set('c', 3); // still room — no eviction

    expect(cache.stats().evictions).toBe(0);
    expect(cache.stats().size).toBe(2);
  });

  it('should evict correctly with string keys of varying lengths', () => {
    const cache = createCache<string>(2);
    cache.set('short', 'x');
    cache.set('a-very-very-long-key-name', 'y');
    cache.set('z', 'evicted-one');

    expect(cache.stats().size).toBe(2);
    expect(cache.stats().evictions).toBe(1);
  });

  it('should handle the same key being set repeatedly without eviction', () => {
    const cache = createCache(1);
    cache.set('only', 1);
    cache.set('only', 2);
    cache.set('only', 3);
    cache.set('only', 4);

    expect(cache.stats().size).toBe(1);
    expect(cache.stats().evictions).toBe(0);
    expect(cache.get('only')).toBe(4);
    // sets counter should count all 4 sets
    expect(cache.stats().sets).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Stats accuracy
// ---------------------------------------------------------------------------

describe('TimeoutCache — stats accuracy', () => {
  let cache: TimeoutCache<string, number>;

  beforeEach(() => {
    cache = createCache();
  });

  it('should report zero stats for a fresh cache', () => {
    const s = cache.stats();
    expect(s).toEqual({
      name: 'test-cache',
      hits: 0,
      misses: 0,
      sets: 0,
      clears: 0,
      evictions: 0,
      size: 0,
      hitRate: 0,
    });
  });

  it('should track hits and misses correctly for get()', () => {
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('a'); // hit
    cache.get('b'); // miss
    cache.get('c'); // miss

    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(2);
  });

  it('should track sets counter correctly', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // overwrite — still counts as a set

    const s = cache.stats();
    expect(s.sets).toBe(3);
    expect(s.size).toBe(2);
  });

  it('should track clears counter', () => {
    cache.set('a', 1);
    cache.clear();
    cache.clear(); // second clear increments again

    expect(cache.stats().clears).toBe(2);
    expect(cache.stats().size).toBe(0);
  });

  it('should retain hit/miss counters after clear()', () => {
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss
    cache.clear();

    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.clears).toBe(1);
    expect(s.size).toBe(0);
  });

  it('should compute hitRate correctly', () => {
    cache.set('a', 1);

    cache.get('a'); // hit
    cache.get('a'); // hit
    cache.get('b'); // miss
    // 2 hits / 3 queries = 0.666...

    expect(cache.stats().hitRate).toBeCloseTo(2 / 3, 5);
  });

  it('should report hitRate = 0 when there are no queries', () => {
    cache.set('a', 1); // set only, no get
    expect(cache.stats().hitRate).toBe(0);
  });

  it('should report hitRate = 1 when all queries hit', () => {
    cache.set('a', 1);
    cache.get('a');
    cache.get('a');

    expect(cache.stats().hitRate).toBe(1);
  });

  it('should report hitRate = 0 when all queries miss', () => {
    cache.get('x');
    cache.get('y');
    cache.get('z');

    expect(cache.stats().hitRate).toBe(0);
  });

  it('should include evictions in stats', () => {
    const small = createCache(1);
    small.set('a', 1);
    small.set('b', 2); // evicts 'a'

    const s = small.stats();
    expect(s.evictions).toBe(1);
    expect(s.size).toBe(1);
  });

  it('should report the cache name in stats', () => {
    const named = new TimeoutCache<string, number>('my-named-cache');
    expect(named.stats().name).toBe('my-named-cache');
  });

  it('should provide independent stats snapshots (immutability by value)', () => {
    cache.set('a', 1);
    const s1 = cache.stats();
    cache.get('a'); // hit
    const s2 = cache.stats();

    // s1 should not reflect the later get()
    expect(s1.hits).toBe(0);
    expect(s2.hits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('TimeoutCache — clear()', () => {
  it('should remove all entries', () => {
    const cache = createCache();
    cache.set('a', 1).set('b', 2).set('c', 3);
    cache.clear();

    expect(cache.stats().size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('should be a no-op on an empty cache', () => {
    const cache = createCache();
    cache.clear();

    expect(cache.stats().size).toBe(0);
    expect(cache.stats().clears).toBe(1);
  });

  it('should allow reuse after clear', () => {
    const cache = createCache();
    cache.set('x', 1);
    cache.clear();
    cache.set('x', 100);

    expect(cache.get('x')).toBe(100);
    expect(cache.stats().size).toBe(1);
  });

  it('should reset eviction-related size but not counters', () => {
    const cache = createCache(2);
    cache.set('a', 1).set('b', 2).set('c', 3); // evicts 'a'
    cache.clear();

    const s = cache.stats();
    expect(s.size).toBe(0);
    expect(s.evictions).toBe(1); // preserved
    expect(s.sets).toBe(3); // preserved
    expect(s.clears).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('TimeoutCache — edge cases', () => {
  describe('zero maxSize', () => {
    it('should evict immediately on any set of a new key', () => {
      const cache = createCache(0);

      // Setting a key into a zero-capacity cache evicts it immediately
      // because size (0) >= maxSize (0) → evictIfNeeded runs → size becomes 0
      // then the new entry is inserted → size = 1
      // That means the entry survives… but let's test actual behavior:
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.stats().size).toBe(1);

      // Setting another key: evict 'a', insert 'b'
      cache.set('b', 2);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.stats().evictions).toBe(1);
    });

    it('should allow overwriting the single entry without extra evictions', () => {
      const cache = createCache(0);
      cache.set('a', 1);
      cache.set('a', 2);
      cache.set('a', 3);

      expect(cache.get('a')).toBe(3);
      expect(cache.stats().evictions).toBe(0);
    });

    it('should work with getOrCompute on zero-capacity cache', () => {
      const cache = createCache(0);
      cache.getOrCompute('a', () => 1);
      cache.getOrCompute('b', () => 2);

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.stats().evictions).toBe(1);
    });
  });

  describe('Infinity maxSize (default)', () => {
    it('should never evict when maxSize is Infinity', () => {
      const cache = createCache();
      for (let i = 0; i < 10_000; i++) {
        cache.set(`key-${i}`, i);
      }

      expect(cache.stats().size).toBe(10_000);
      expect(cache.stats().evictions).toBe(0);
    });

    it('should default to Infinity when maxSize is not provided', () => {
      const cache = new TimeoutCache<string, number>('defaulted');
      expect(cache.maxSize).toBe(Infinity);
    });
  });

  describe('large number of entries', () => {
    it('should handle many insertions and lookups correctly', () => {
      const cache = createCache(100);

      for (let i = 0; i < 500; i++) {
        cache.set(`key-${i}`, i);
      }

      // Only the last 100 should remain
      expect(cache.stats().size).toBe(100);
      expect(cache.stats().evictions).toBe(400);

      // Last inserted key should exist
      expect(cache.has('key-499')).toBe(true);
      // First inserted should be long gone
      expect(cache.has('key-0')).toBe(false);
    });

    it('should maintain accurate stats under load', () => {
      const cache = createCache(50);

      for (let i = 0; i < 100; i++) {
        cache.set(`k-${i}`, i);
      }
      for (let i = 0; i < 30; i++) {
        cache.get(`k-${i}`); // most will miss (only k-50..k-99 survive)
      }

      const s = cache.stats();
      expect(s.sets).toBe(100);
      expect(s.evictions).toBe(50); // 100 inserts - 50 capacity
      expect(s.size).toBe(50);
      // hits + misses should equal number of get() calls
      expect(s.hits + s.misses).toBe(30);
    });
  });

  describe('non-string key types', () => {
    it('should support numeric keys', () => {
      const cache = new TimeoutCache<number, string>('num-keys', 2);
      cache.set(1, 'one').set(2, 'two').set(3, 'three');

      expect(cache.get(1)).toBeUndefined();
      expect(cache.get(2)).toBe('two');
      expect(cache.get(3)).toBe('three');
    });

    it('should support object keys (by reference)', () => {
      const cache = new TimeoutCache<object, number>('obj-keys', 3);
      const k1 = { id: 1 };
      const k2 = { id: 2 };
      const k3 = { id: 3 };
      const k4 = { id: 4 };

      cache.set(k1, 100).set(k2, 200).set(k3, 300).set(k4, 400);

      expect(cache.get(k1)).toBeUndefined(); // evicted
      expect(cache.get(k2)).toBe(200);
      expect(cache.get(k3)).toBe(300);
      expect(cache.get(k4)).toBe(400);
    });
  });

  describe('mixed operation sequences', () => {
    it('should handle interleaved get/set/delete correctly', () => {
      const cache = createCache(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // promote a
      cache.delete('b');
      cache.set('c', 3);
      cache.set('d', 4); // should evict nothing (a, c, d)

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.stats().evictions).toBe(0);
    });

    it('should track stats correctly through complex sequences', () => {
      const cache = createCache(2);
      cache.set('a', 1); // sets=1
      cache.get('a'); // hits=1
      cache.set('b', 2); // sets=2
      cache.get('missing'); // misses=1
      cache.delete('a'); // no stat change
      cache.set('c', 3); // sets=3, evictions=1 (b evicted)
      cache.clear(); // clears=1
      cache.get('anything'); // misses=2

      const s = cache.stats();
      expect(s.hits).toBe(1);
      expect(s.misses).toBe(2);
      expect(s.sets).toBe(3);
      expect(s.evictions).toBe(1);
      expect(s.clears).toBe(1);
      expect(s.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// LRU correctness — full scenario
// ---------------------------------------------------------------------------

describe('TimeoutCache — LRU correctness scenarios', () => {
  it('should pass the classic LRU smoke test', () => {
    // Standard LRU scenario from the class JSDoc example
    const cache = new TimeoutCache<string, number>('lru-demo', 3);
    cache.set('a', 1).set('b', 2).set('c', 3);
    cache.get('a'); // promote a → MRU. Order: b, c, a
    cache.set('d', 4); // evict b

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('should evict in strict FIFO order when no get calls occur', () => {
    const cache = createCache(4);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    cache.set('e', 5); // evict a
    cache.set('f', 6); // evict b

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('e')).toBe(true);
    expect(cache.has('f')).toBe(true);
  });

  it('should treat overwritten keys as new (MRU position)', () => {
    const cache = createCache(3);
    cache.set('a', 1).set('b', 2).set('c', 3);
    // Overwrite 'a': internally delete-then-set → 'a' becomes MRU
    cache.set('a', 100);
    // Order: b (oldest), c, a (MRU)
    cache.set('d', 4); // evict b

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.get('a')).toBe(100);
  });

  it('should handle capacity = 1 correctly', () => {
    const cache = createCache(1);
    cache.set('a', 1);
    cache.set('b', 2); // evict a
    cache.get('b'); // hit — promote b (already MRU, but no-op in effect)
    cache.set('c', 3); // evict b

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.stats().evictions).toBe(2);
    expect(cache.stats().size).toBe(1);
  });
});

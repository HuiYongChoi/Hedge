import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPreferredLanguage, setPreferredLanguage } from './language-preferences';

describe('language-preferences', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should return "en" as default when localStorage is empty', () => {
    const language = getPreferredLanguage();
    expect(language).toBe('en');
  });

  it('should return stored language preference', () => {
    localStorage.setItem('preferred-language', 'ko');
    const language = getPreferredLanguage();
    expect(language).toBe('ko');
  });

  it('should return "en" for invalid stored value', () => {
    localStorage.setItem('preferred-language', 'fr');
    const language = getPreferredLanguage();
    expect(language).toBe('en');
  });

  it('should save language preference to localStorage', () => {
    setPreferredLanguage('ko');
    const stored = localStorage.getItem('preferred-language');
    expect(stored).toBe('ko');
  });

  it('should handle localStorage errors gracefully', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage error');
    });

    const language = getPreferredLanguage();
    expect(language).toBe('en');
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

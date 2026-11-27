import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { getLanguage, setLanguage, t, translate } from './index';

afterEach(() => setLanguage('en'));

describe('i18n', () => {
  it('every key in en exists in fr', () => {
    const missing = (Object.keys(en) as (keyof typeof en)[]).filter((k) => !(k in fr));
    expect(missing).toEqual([]);
  });

  it('falls back to English when fr lacks a key', () => {
    expect(translate('fr', 'tab.home', undefined, { en: { 'tab.home': 'Home' }, fr: {} })).toBe('Home');
  });

  it('switches language and interpolates vars', () => {
    expect(t('tab.home')).toBe('Home');
    setLanguage('fr');
    expect(getLanguage()).toBe('fr');
    expect(t('tab.home')).toBe('Accueil');
    expect(translate('en', 'k', { n: 3 }, { en: { k: 'x {n} y' } })).toBe('x 3 y');
  });
});

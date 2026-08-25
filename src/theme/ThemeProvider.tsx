import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorTokens, darkColors, layout, lightColors, type } from './tokens';

/** Matches the Settings > Color Scheme row, which offers System / Light / Dark. */
export type ColorSchemePreference = 'system' | 'light' | 'dark';

type ThemeValue = {
  colors: ColorTokens;
  type: typeof type;
  layout: typeof layout;
  scheme: 'light' | 'dark';
  preference: ColorSchemePreference;
  setPreference: (next: ColorSchemePreference) => void;
};

const STORAGE_KEY = 'chatgpt-clone/color-scheme';

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const rawScheme = useColorScheme();
  const systemScheme: 'light' | 'dark' = rawScheme === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ColorSchemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // A read failure just means we stay on the system default.
      });
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme = preference === 'system' ? systemScheme : preference;
    return {
      colors: scheme === 'dark' ? darkColors : lightColors,
      type,
      layout,
      scheme,
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

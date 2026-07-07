import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getProfile, updateUsername } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

interface SignUpResult {
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean; // initial session bootstrap
  profileLoading: boolean;
  refetchProfile: () => Promise<void>;
  signUp: (email: string, password: string, username?: string) => Promise<SignUpResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data: profile,
    isLoading: profileLoading,
    refetch,
  } = useQuery({
    queryKey: ['profile', session?.user.id ?? null],
    queryFn: getProfile,
    enabled: !!session,
    staleTime: 15_000,
  });

  async function refetchProfile() {
    await refetch();
  }

  async function signUp(email: string, password: string, username?: string): Promise<SignUpResult> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);

    if (data.session) {
      setSession(data.session);
      if (username && username.trim()) {
        try {
          await updateUsername(username.trim());
        } catch {
          // Non-fatal: profile row may still be settling from the auth trigger.
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      return { needsEmailConfirmation: false };
    }

    return { needsEmailConfirmation: true };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  const value: AuthContextValue = {
    session,
    profile: profile ?? null,
    loading,
    profileLoading,
    refetchProfile,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

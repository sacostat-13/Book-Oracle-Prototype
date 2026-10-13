// src/contexts/domains/plans.js — Passages (reading plans): save and delete.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';

/**
 * Called once by DataProvider; returns setCurrentPlan, deletePlan.
 * @param {object} deps  user, setState — from DataProvider and earlier domains
 */
export function usePlans({ user, setState }) {
  const setCurrentPlan = useCallback(
    async (plan) => {
      if (!plan) return null;
      if (user) {
        const { data, error } = await supabase
          .from('plans')
          .insert({
            user_id: user.id,
            title: plan.title || 'Untitled Plan',
            content: plan,
          })
          .select()
          .single();
        if (!error && data) {
          const saved = { ...plan, _id: data.id, createdAt: data.created_at };
          setState((s) => ({
            ...s,
            currentPlan: saved,
            plans: [saved, ...(s.plans || [])],
          }));
          return saved;
        } else {
          if (error) console.error('setCurrentPlan Supabase insert failed:', error);
          setState((s) => ({
            ...s,
            currentPlan: plan,
            plans: [plan, ...(s.plans || [])],
          }));
          return plan;
        }
      } else {
        setState((s) => ({
          ...s,
          currentPlan: plan,
          plans: [plan, ...(s.plans || [])],
        }));
        return plan;
      }
    },
    [user, setState]
  );

  const deletePlan = useCallback(
    async (planId) => {
      // Remove from local state immediately so UI reflects change without refresh
      setState((s) => {
        const remaining = (s.plans || []).filter((p) => p._id !== planId);
        return {
          ...s,
          plans: remaining,
          currentPlan: remaining[0] || null,
        };
      });
      // Persist to Supabase
      if (user && planId) {
        await supabase.from('plans').delete().eq('id', planId).eq('user_id', user.id);
      }
    },
    [user, setState]
  );

  return { setCurrentPlan, deletePlan };
}

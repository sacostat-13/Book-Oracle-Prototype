import { createContext, useContext, useState, useCallback } from 'react';

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [route, setRouteState] = useState({ name: 'dashboard', params: {} });

  const go = useCallback((name, params = {}) => {
    setRouteState({ name, params });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <RouterContext.Provider value={{ route, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = () => useContext(RouterContext);

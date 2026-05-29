import { useData } from '../lib/DataContext';

export default function Toast() {
  const { toast } = useData();
  if (!toast) return null;
  return (
    <div className={`toast show ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>
  );
}

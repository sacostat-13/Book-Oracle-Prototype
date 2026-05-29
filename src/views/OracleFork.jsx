import { useRouter } from '../lib/RouterContext';

export default function OracleFork() {
  const { go } = useRouter();

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Wishlist Oracle
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Wishlist Oracle</div>
        <h1 className="page-title">How shall we <span className="accent">divine</span>?</h1>
        <p className="page-subtitle">Two ways to draw books from the vault.</p>
      </div>
      <div className="oracle-fork">
        <div className="cta-card" onClick={() => go('oracle-categories')}>
          <div className="cta-ornament">❦</div>
          <h2 className="cta-title">By <span className="accent">categories</span></h2>
          <p className="cta-desc">Pick a temperament — folk horror, gothic, sapphic, Latin American — and draw three books to choose from.</p>
        </div>
        <div className="cta-card" onClick={() => go('oracle-similar')}>
          <div className="cta-ornament">✦</div>
          <h2 className="cta-title">Based on <span className="accent">other books</span></h2>
          <p className="cta-desc">Tell us 1–3 books you've loved. We'll find others with the same blood in them.</p>
        </div>
      </div>
    </>
  );
}

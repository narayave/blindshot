export default function Home() {
  return (
    <div className="shell theme-base">
      <main className="app">
        <header className="top"><span className="wordmark">blindshot</span></header>
        <section className="stack">
          <h1 className="headline">A disposable camera<br /><em>for your party.</em></h1>
          <p className="lede">Guests scan a QR code and get 13 shots in a one-inch viewfinder. No previews. The whole roll develops after the party, with a real film look, and everyone gets to see it.</p>
          <div className="stripes" aria-hidden><i /><i /><i /></div>
          <p className="fine">Got a QR code from a host? Scan it to load your film.</p>
        </section>
      </main>
    </div>
  );
}

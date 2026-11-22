"use client";

// Last resort when even the root layout fails: no translations or styles are available here, so the message is
// shown in the three languages of the app with inline styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f4ee", color: "#1f2a27" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center", background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 10px 30px -20px rgba(0,0,0,.35)" }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>Une erreur est survenue</h1>
            <p style={{ margin: "6px 0 0", color: "#5b6662" }}>Something went wrong</p>
            <p dir="rtl" style={{ margin: "6px 0 0", color: "#5b6662" }}>حدث خطأ</p>
            <button type="button" onClick={reset} style={{ marginTop: 20, padding: "10px 18px", borderRadius: 10, border: 0, background: "#1f5c4e", color: "#fff", fontSize: 15, cursor: "pointer" }}>
              Réessayer · Try again · إعادة المحاولة
            </button>
            {error.digest ? <p style={{ marginTop: 16, fontFamily: "monospace", fontSize: 12, color: "#5b6662" }}>Ref: {error.digest}</p> : null}
          </div>
        </main>
      </body>
    </html>
  );
}

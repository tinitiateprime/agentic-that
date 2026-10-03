"use client";

export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            fontFamily: "Arial, sans-serif",
            background: "#f7faf8",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: "420px" }}>
            <h2>Something went wrong</h2>

            <p>
              We couldn't load this page correctly. Please try again.
            </p>

            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 18px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
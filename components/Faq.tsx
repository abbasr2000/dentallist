export function Faq({
  items,
}: {
  items: Array<{ question: string; answer: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }}>
      <h2 style={{ fontSize: "1.3rem", marginBottom: 16 }}>Common questions</h2>
      <div style={{ display: "grid", gap: 18 }} className="prose-col">
        {items.map((item) => (
          <div key={item.question}>
            <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>{item.question}</h3>
            <p style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: 15.5 }}>
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Breadcrumbs({
  trail,
}: {
  trail: Array<{ name: string; path: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 18 }}>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13.5, color: "var(--color-ink-faint)" }}>
        {trail.map((item, i) => (
          <li key={item.path} style={{ display: "flex", gap: 8 }}>
            {i < trail.length - 1 ? (
              <>
                <a href={item.path} className="inline-link">{item.name}</a>
                <span aria-hidden="true">›</span>
              </>
            ) : (
              <span aria-current="page">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

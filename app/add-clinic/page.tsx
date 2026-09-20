import type { Metadata } from "next";
import { paths } from "@/lib/site";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Add or claim a clinic",
  description:
    "Add a dental practice to the directory, or claim an existing listing to keep its details current.",
  alternates: { canonical: paths.addClinic() },
};

export default function AddClinicPage() {
  const trail = [
    { name: "Home", path: paths.home() },
    { name: "Add a clinic", path: paths.addClinic() },
  ];

  return (
    <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
      <Breadcrumbs trail={trail} />
      <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 16 }}>
        Add or claim a clinic
      </h1>
      <div className="prose-col" style={{ display: "grid", gap: 15 }}>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", margin: 0 }}>
          Listing is free. We do not require a link back to this site in exchange
          for one.
        </p>
        <p style={{ margin: 0 }}>
          Claiming a listing lets you fill in the things we cannot get from public
          records: fee ranges, who is on staff, which insurers you bill directly,
          and whether you are currently taking new patients.
        </p>
        <div className="panel">
          <p style={{ margin: 0, fontSize: 15.5, color: "var(--color-ink-soft)" }}>
            The claim form is not built yet. It arrives with the owner
            verification flow. In the meantime, see{" "}
            <a href={paths.methodology()} className="inline-link">how ranking works</a>{" "}
            and{" "}
            <a href={paths.sources()} className="inline-link">where our data comes from</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { Invoice, User } from "../types";
import { Sidebar } from "./Sidebar";

interface Props {
  orgId: string;
}

interface DashboardData {
  users: User[];
  invoices: Invoice[];
}

export function Dashboard({ orgId }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/billing/invoices").then((r) => r.json()),
    ])
      .then(([u, b]) => {
        if (cancelled) return;
        setData({ users: u.users, invoices: b.invoices });
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const mrr = data.invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="flex h-screen">
      <Sidebar orgId={orgId} />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Stat label="Members" value={data.users.length} />
          <Stat label="Paid invoices" value={data.invoices.filter((i) => i.status === "paid").length} />
          <Stat label="MRR" value={`$${(mrr / 100).toFixed(2)}`} />
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

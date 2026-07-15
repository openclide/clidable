interface Props {
  orgId: string;
}

const NAV = [
  { label: "Overview", href: "/" },
  { label: "Members", href: "/members" },
  { label: "Billing", href: "/billing" },
  { label: "Audit log", href: "/audit" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar({ orgId }: Props) {
  return (
    <aside className="w-56 shrink-0 border-r bg-gray-50 p-4">
      <div className="mb-6 text-xs uppercase tracking-wide text-gray-500">
        org · {orgId}
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded px-2 py-1.5 text-sm hover:bg-gray-200"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

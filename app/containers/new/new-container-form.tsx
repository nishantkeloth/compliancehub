"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ContainerForm from "../container-form";
import { createContainer } from "../actions";

export default function NewContainerForm() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      {error && <div className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      <ContainerForm
        submitLabel="Create container"
        busy={busy}
        onSubmit={(fd) => {
          setError(null);
          startTransition(async () => {
            const res = await createContainer(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
            router.push(res?.id ? `/containers/${res.id}` : "/containers");
          });
        }}
      />
    </div>
  );
}

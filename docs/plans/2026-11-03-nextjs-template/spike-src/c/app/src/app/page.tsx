import { connection } from "next/server";
import { Suspense } from "react";
import { Counter } from "./counter";

// Nonces need a per-request render (Next.js CSP guide, "Forcing dynamic rendering").
async function Dynamic() {
  await connection();
  return <p>public url: {process.env.NEXT_PUBLIC_APP_URL ?? "(unset)"} | server env: {process.env.SPIKE_RUNTIME ?? "(unset)"}</p>;
}

export default function Page() {
  return (
    <main>
      <h1>spike-c</h1>
      <Suspense fallback={<p>loading</p>}>
        <Dynamic />
      </Suspense>
      <Counter />
      <img src="/logo.svg" alt="" width={16} height={16} />
    </main>
  );
}

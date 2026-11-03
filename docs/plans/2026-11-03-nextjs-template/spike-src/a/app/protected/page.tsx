import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/session";
import { sharedUnguarded } from "../shared-actions";
import { protectedGuarded, protectedUnguarded } from "./actions";

export default async function Protected() {
  const account = await currentAccount();
  if (!account) redirect("/");
  return (
    <main>
      <p>hello {account}</p>
      <form action={protectedUnguarded.bind(null, "form")}><button>unguarded</button></form>
      <form action={protectedGuarded.bind(null, "form")}><button>guarded</button></form>
      <form action={sharedUnguarded.bind(null, "protected")}><button>shared</button></form>
    </main>
  );
}

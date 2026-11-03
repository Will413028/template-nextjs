import { sharedUnguarded } from "./shared-actions";
import { argonInfo, ping, signIn, signUp, whoami } from "./actions";

export default function Home() {
  return (
    <main>
      <form action={ping.bind(null, "form")}><button>ping</button></form>
      <form action={signUp.bind(null, "a", "b")}><button>signUp</button></form>
      <form action={signIn.bind(null, "a", "b")}><button>signIn</button></form>
      <form action={async () => { "use server"; await whoami(); await argonInfo(); }}><button>misc</button></form>
      <form action={sharedUnguarded.bind(null, "public")}><button>shared</button></form>
    </main>
  );
}

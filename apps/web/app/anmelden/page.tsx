import type { Metadata } from "next";

import { PageHeader } from "@easytree/ui";

import { LoginForm } from "../../components/login-form";

export const metadata: Metadata = { title: "Anmelden — easyTree" };

/**
 * Anmeldeseite (EYT-106). Muster wie `app/page.tsx`: Fragment, KEIN eigenes
 * `<main>` — die Landmark stellt die AppShell.
 */
export default function AnmeldenPage() {
  return (
    <>
      <PageHeader
        title="Anmelden"
        description="Mit deinem easyTree-Konto — die Sitzung bleibt in sicheren Cookies, nie im Browserspeicher."
      />
      <LoginForm />
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/admin/ToastProvider";
import { COMPANY } from "@/lib/data";

/**
 * Admin sign-in. Validation is front-end only and there is no session — this
 * phase ships UI, not auth. The domain rule mirrors the intended policy:
 * accounts are @ornament.id addresses, and the CMS is on a private domain with
 * no link from the public site.
 *
 * The fields start empty on purpose. A prefilled password makes for a snappier
 * demo but reads as a committed credential, which is the wrong thing to have
 * sitting in a repository.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@ornament.id")) {
      setError("Gunakan email @ornament.id.");
      return;
    }
    if (password.length < 8) {
      setError("Kata sandi minimal 8 karakter.");
      return;
    }
    setError("");
    toast("Selamat datang kembali, Rani.");
    router.push("/admin");
  };

  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="flex w-full max-w-[420px] flex-col gap-4.4">
        <div className="flex justify-center">
          <Logo height={30} />
        </div>

        <form onSubmit={submit} className="ad-panel flex flex-col gap-3.5 px-8 py-7">
          <div>
            <div className="text-kicker uppercase text-muted-50">Admin CMS</div>
            <h3 className="mt-1.5">Masuk</h3>
          </div>

          <Field label="Email">
            <input
              className="input"
              type="email"
              autoComplete="username"
              placeholder="nama@ornament.id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Kata sandi">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Minimal 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error ? (
            <p className="m-0 text-admin-sm text-accent-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 text-[13px]">
            <label className="radio">
              <input type="radio" name="remember" defaultChecked />
              <span className="dot" />
              Ingat saya
            </label>
            <a href="#">Lupa sandi?</a>
          </div>

          <button type="submit" className="btn btn-primary btn-block mt-1 py-3 text-[15px]">
            Masuk ke dashboard
          </button>

          <p className="m-0 text-center text-[12px] text-muted-55">
            Akses dibatasi untuk tim Ornament. Domain terpisah dari situs publik.
          </p>
        </form>

        <p className="m-0 text-center text-[12px] text-muted-45">© 2026 {COMPANY.name}</p>
      </div>
    </div>
  );
}

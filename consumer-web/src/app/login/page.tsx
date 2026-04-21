"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginCustomer } from "@/lib/api/consumer";
import { useSessionStore } from "@/lib/store/session-store";
import { AppShell, Button, Card, Input, SectionTitle } from "@/components/ui";
import { TopNav } from "@/components/top-nav";

const schema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [redirect] = useState(
    () =>
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("redirect") || "/"
        : "/",
  );
  const setSession = useSessionStore((s) => s.setSession);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const password = params.get("password");
    if (email) form.setValue("email", email);
    if (password) form.setValue("password", password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: loginCustomer,
    onSuccess: ({ token, customer }) => {
      setSession(token, customer);
      router.push(redirect);
    },
  });

  const onSubmit = form.handleSubmit((values) => loginMutation.mutate(values));

  return (
    <AppShell>
      <TopNav />
      <div className="mx-auto max-w-md">
        <SectionTitle title="Login" subtitle="Sign in to continue your order." />
        <Card>
          <p className="mb-3 text-xs text-zinc-400">
            Use a <span className="font-semibold text-zinc-200">consumer customer</span>{" "}
            account here (not admin owner credentials).
          </p>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Email</label>
              <Input type="email" {...form.register("email")} />
              {form.formState.errors.email ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.email.message}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Password</label>
              <Input type="password" {...form.register("password")} />
              {form.formState.errors.password ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.password.message}</p>
              ) : null}
            </div>
            {loginMutation.isError ? (
              <p className="text-sm text-red-300">Login failed. Please check your credentials.</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Signing in..." : "Login"}
            </Button>
          </form>
          <p className="mt-3 text-sm text-zinc-400">
            No account?{" "}
            <Link href={`/register?redirect=${encodeURIComponent(redirect)}`} className="text-red-400">
              Register
            </Link>
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

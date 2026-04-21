"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginCustomer, registerCustomer } from "@/lib/api/consumer";
import { useSessionStore } from "@/lib/store/session-store";
import { AppShell, Button, Card, Input, SectionTitle } from "@/components/ui";
import { TopNav } from "@/components/top-nav";

const schema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().min(10, "Phone is required"),
    password: z.string().min(6, "Password must be at least 6 chars"),
    confirm_password: z.string().min(6, "Confirm your password"),
  })
  .refine((v) => v.password === v.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

type RegisterForm = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [redirect] = useState(
    () =>
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("redirect") || "/"
        : "/",
  );
  const setSession = useSessionStore((s) => s.setSession);

  const form = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      confirm_password: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerCustomer,
    onSuccess: async (customer) => {
      const login = await loginCustomer({
        email: customer.email || form.getValues("email"),
        password: form.getValues("password"),
      });
      setSession(login.token, login.customer);
      router.push(redirect);
    },
  });

  const onSubmit = form.handleSubmit((values) => registerMutation.mutate(values));

  return (
    <AppShell>
      <TopNav />
      <div className="mx-auto max-w-md">
        <SectionTitle title="Register" subtitle="Create your account to place orders." />
        <Card>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Name</label>
              <Input {...form.register("name")} />
              {form.formState.errors.name ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.name.message}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Email</label>
              <Input type="email" {...form.register("email")} />
              {form.formState.errors.email ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.email.message}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Phone</label>
              <Input {...form.register("phone")} />
              {form.formState.errors.phone ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.phone.message}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Password</label>
              <Input type="password" {...form.register("password")} />
              {form.formState.errors.password ? (
                <p className="mt-1 text-xs text-red-300">{form.formState.errors.password.message}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Confirm password</label>
              <Input type="password" {...form.register("confirm_password")} />
              {form.formState.errors.confirm_password ? (
                <p className="mt-1 text-xs text-red-300">
                  {form.formState.errors.confirm_password.message}
                </p>
              ) : null}
            </div>
            {registerMutation.isError ? (
              <p className="text-sm text-red-300">
                Registration failed. Please verify your details.
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "Creating account..." : "Register"}
            </Button>
          </form>
          <p className="mt-3 text-sm text-zinc-400">
            Already have an account?{" "}
            <Link href={`/login?redirect=${encodeURIComponent(redirect)}`} className="text-red-400">
              Login
            </Link>
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

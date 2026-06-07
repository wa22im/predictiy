import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const protectedRoutes = ["/dashboard", "/groups", "/join", "/onboarding", "/admin"];
const onboardingRoute = "/onboarding";
const loginRoute = "/login";
const landingRoute = "/";
const adminPrefix = "/admin";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const [key, value] of Object.entries(headers)) {
            if (typeof value === "string") {
              supabaseResponse.headers.set(key, value);
            }
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = !!user;
  const isOnboarded = !!user?.user_metadata?.nickname;

  // Determine if the current path is protected
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
  const isAdminRoute = pathname === adminPrefix || pathname.startsWith(adminPrefix + "/");
  const isAuthRoute =
    pathname === loginRoute ||
    pathname === "/signup" ||
    pathname.startsWith("/auth/");
  const isLanding = pathname === landingRoute;
  const isOnboardingPage = pathname === onboardingRoute;

  // Unauthenticated users trying to access protected routes → login
  if (!isAuthenticated && isProtectedRoute) {
    const loginUrl = new URL(loginRoute, request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users without a profile → onboarding
  if (isAuthenticated && !isOnboarded && !isOnboardingPage && !isAuthRoute && !isAdminRoute) {
    const onboardingUrl = new URL(onboardingRoute, request.url);
    return NextResponse.redirect(onboardingUrl);
  }

  // Non-admin users trying to access admin routes → dashboard
  if (isAuthenticated && isAdminRoute) {
    const isAdmin = !!user?.user_metadata?.isAdmin;
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  // Already authenticated users on public pages → redirect to dashboard
  if (isAuthenticated && (isLanding || isAuthRoute)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

// NavLink.tsx
import { NavLink as RouterNavLink, NavLinkProps } from "react-router-dom";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/storage"; // 🔹 NEW

interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, ...props }, ref) => {
    const currentUser = getCurrentUser();

    // 🔒 RBAC: hide Security link from non-security users
    if (typeof to === "string" && to === "/security") {
      const email = currentUser?.empemail?.toLowerCase();
      if (email !== "security@premierenergies.com") {
        return null;
      }
    }

    return (
      <RouterNavLink
        ref={ref}
        to={to}
        className={({ isActive, isPending }) =>
          cn(
            className,
            isActive && activeClassName,
            isPending && pendingClassName
          )
        }
        {...props}
      />
    );
  }
);

NavLink.displayName = "NavLink";

export { NavLink };

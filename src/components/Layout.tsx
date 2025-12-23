// Layout.tsx
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "./NavLink";
import { Button } from "./ui/button";
import {
  Waves,
  LayoutDashboard,
  FileText,
  BarChart3,
  Shield,
  LogOut,
} from "lucide-react";
import { setCurrentUser, getCurrentUser } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const currentUser = getCurrentUser();

  const isSecurityUser =
    currentUser?.empemail?.toLowerCase() === "security@premierenergies.com";

  const handleLogout = () => {
    setCurrentUser(null);
    toast({
      title: "Logged Out",
      description: "You have been successfully logged out",
    });
    navigate("/login");
  };

  // 🔒 Nav items depend on role
  const navItems = isSecurityUser
    ? [
        {
          path: "/security",
          icon: Shield,
          label: "Security",
        },
      ]
    : [
        { path: "/overview", icon: LayoutDashboard, label: "Overview" },
        { path: "/request", icon: FileText, label: "New Request" },
        { path: "/analytics", icon: BarChart3, label: "Analytics" },
      ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-gradient-primary p-2">
                <Waves className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold">WAVE</h1>
                <p className="text-xs text-muted-foreground">
                  Welcome & Authenticate Visitor Entry
                </p>
              </div>
            </div>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink key={item.path} to={item.path}>
                  <Button
                    variant={
                      location.pathname === item.path ? "default" : "ghost"
                    }
                    size="sm"
                    className="gap-2"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              {currentUser && (
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium">{currentUser.empname}</p>
                  <p className="text-xs text-muted-foreground">
                    {currentUser.designation}
                    {isSecurityUser ? " • Security" : ""}
                  </p>
                </div>
              )}
              <Button
                onClick={handleLogout}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav className="md:hidden border-b bg-card">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-around py-2">
            {navItems.map((item) => (
              <NavLink key={item.path} to={item.path}>
                <Button
                  variant={
                    location.pathname === item.path ? "default" : "ghost"
                  }
                  size="sm"
                  className="flex-col h-auto py-2 px-3"
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-xs mt-1">{item.label}</span>
                </Button>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
};

export default Layout;

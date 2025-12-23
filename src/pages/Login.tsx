import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getEmployeeByEmail,
  setCurrentUser,
  generateOTP,
  saveOTP,
  verifyOTP,
  type Employee,
} from "@/lib/storage";
import { Waves } from "lucide-react";

const Login = () => {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [generatedOTP, setGeneratedOTP] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [employeeForLogin, setEmployeeForLogin] = useState<Employee | null>(
    null
  );

  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSendOTP = async () => {
    if (!email.endsWith("@premierenergies.com")) {
      toast({
        title: "Invalid Email",
        description: "Please use your Premier Energies email address",
        variant: "destructive",
      });
      return;
    }

    // 1) Try local cache first (seeded from initializeDefaultData)
    let employee = getEmployeeByEmail(email);

    // 2) If not found locally, fall back to BACKEND API
    if (!employee) {
      try {
        const res = await fetch(
          `/api/employees/email/${encodeURIComponent(email)}`
        );
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            employee = json.data as Employee;
          }
        }
      } catch (err) {
        console.error("[Login] Failed to fetch employee from API:", err);
      }
    }

    if (!employee) {
      toast({
        title: "Employee Not Found",
        description: "Email address not found in the system",
        variant: "destructive",
      });
      return;
    }

    // Keep reference so we don't depend on localStorage later
    setEmployeeForLogin(employee);

    const newOTP = generateOTP();
    saveOTP(email, newOTP);
    setGeneratedOTP(newOTP);
    setStep("otp");

    toast({
      title: "OTP Generated",
      description: `Your OTP is: ${newOTP}`,
    });
  };

  const handleVerifyOTP = () => {
    if (verifyOTP(email, otp)) {
      // Prefer the employee we resolved during send-OTP; fall back to cache
      const employee = employeeForLogin || getEmployeeByEmail(email);
      if (employee) {
        setCurrentUser(employee);
        toast({
          title: "Login Successful",
          description: `Welcome back, ${employee.empname}!`,
        });
        navigate("/overview");
      } else {
        toast({
          title: "Unexpected Error",
          description: "Could not resolve your employee record after OTP.",
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "Invalid OTP",
        description: "The OTP you entered is incorrect or expired",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-primary p-4">
      <Card className="w-full max-w-md shadow-hover">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary p-4">
              <Waves className="h-12 w-12 text-primary-foreground" />
            </div>
          </div>
          <div>
            <CardTitle className="text-3xl font-bold">WAVE</CardTitle>
            <CardDescription className="text-base">
              Welcome & Authenticate Visitor Entry
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.name@premierenergies.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendOTP()}
                />
              </div>
              <Button onClick={handleSendOTP} className="w-full" size="lg">
                Send OTP
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="otp">Enter OTP</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOTP()}
                  maxLength={6}
                />
                <p className="text-sm text-muted-foreground">
                  Your OTP:{" "}
                  <span className="font-mono font-bold text-primary">
                    {generatedOTP}
                  </span>
                </p>
              </div>
              <div className="space-y-2">
                <Button onClick={handleVerifyOTP} className="w-full" size="lg">
                  Verify OTP
                </Button>
                <Button
                  onClick={() => setStep("email")}
                  variant="ghost"
                  className="w-full"
                >
                  Back to Email
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;

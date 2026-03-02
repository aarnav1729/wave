import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import ScrollReveal from "@/components/ScrollReveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getRequests, getCurrentUser, type VisitRequest } from "@/lib/storage";
import { Plus, Search, Edit, ArrowRight, Filter } from "lucide-react";
import { isApprover } from "@/lib/workflow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Overview = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const requests = getRequests();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("creationDatetime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const filteredAndSortedRequests = useMemo(() => {
    if (!currentUser) return [];

    const userEmail = currentUser.empemail?.toLowerCase();
    const userEmpId = currentUser.empid;

    // 🔒 RBAC base filter: only
    // - requests I created, OR
    // - requests where I'm an approver
    let filtered = requests.filter((req) => {
      const isOwner = req.empDetails?.empid === userEmpId;
      const isMyApproval = !!userEmail && isApprover(req, userEmail);

      return isOwner || isMyApproval;
    });

    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (req) =>
          req.ticketNumber.toLowerCase().includes(q) ||
          req.empDetails.empname.toLowerCase().includes(q) ||
          req.purposeOfVisit.toLowerCase().includes(q) ||
          req.meetingWith.toLowerCase().includes(q)
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((req) => req.status === statusFilter);
    }

    // Apply sorting (on a copy so we don't mutate base array)
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any = (a as any)[sortField as keyof VisitRequest];
      let bValue: any = (b as any)[sortField as keyof VisitRequest];

      if (sortField === "empDetails.empname") {
        aValue = a.empDetails.empname;
        bValue = b.empDetails.empname;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [
    requests,
    currentUser,
    searchQuery,
    statusFilter,
    sortField,
    sortDirection,
  ]);

  const getStatusBadge = (request: VisitRequest) => {
    if (request.status === "approved") {
      return (
        <Badge className="bg-success text-success-foreground">Approved</Badge>
      );
    }
    if (request.status === "declined") {
      return (
        <Badge className="bg-destructive text-destructive-foreground">
          Declined
        </Badge>
      );
    }
    if (currentUser && isApprover(request, currentUser.empemail)) {
      return (
        <Badge className="bg-accent text-accent-foreground">
          Action Required
        </Badge>
      );
    }
    return (
      <Badge className="bg-warning text-warning-foreground">Pending</Badge>
    );
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome Section */}
        <ScrollReveal>
          <Card className="border-none shadow-soft bg-gradient-primary text-primary-foreground">
            <CardHeader>
              <CardTitle className="text-2xl">
                Welcome to WAVE, {currentUser?.empname || "User"}!
              </CardTitle>
              <CardDescription className="text-primary-foreground/80">
                Manage visitor requests efficiently and securely
              </CardDescription>
            </CardHeader>
          </Card>
        </ScrollReveal>

        <ScrollReveal delayMs={90}>
          <Card className="bg-gradient-to-r from-sky-50 to-emerald-50">
            <CardHeader>
              <CardTitle className="text-xl">Quick Tutorial</CardTitle>
              <CardDescription>
                1. Create request. 2. Track approval. 3. Share guest QR after approval.
              </CardDescription>
            </CardHeader>
          </Card>
        </ScrollReveal>

        {/* Actions and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ticket, name, purpose..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Requests</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => navigate("/request")}
            size="lg"
            className="gap-2 w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            New Request
          </Button>
        </div>

        {/* Requests Table */}
        <ScrollReveal delayMs={150}>
          <Card>
          <CardHeader>
            <CardTitle>Visit Requests</CardTitle>
            <CardDescription>
              {filteredAndSortedRequests.length} request
              {filteredAndSortedRequests.length !== 1 ? "s" : ""} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort("ticketNumber")}
                    >
                      Ticket Number
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort("empDetails.empname")}
                    >
                      Requested By
                    </TableHead>
                    <TableHead>Visitor Category</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort("tentativeArrival")}
                    >
                      Arrival
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedRequests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No requests found. Create your first request to get
                        started!
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedRequests.map((request) => (
                      <TableRow
                        key={request.ticketNumber}
                        className="hover:bg-muted/50"
                      >
                        <TableCell className="font-mono text-sm font-medium">
                          {request.ticketNumber}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {request.empDetails.empname}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {request.empDetails.dept}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{request.visitorCategory}</TableCell>
                        <TableCell>{request.numberOfGuests}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {request.locationToVisit}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {request.typeOfLocation}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(
                            request.tentativeArrival
                          ).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell>{getStatusBadge(request)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {/* 🔒 Only creator can see Edit button */}
                            {currentUser &&
                              request.empDetails?.empid ===
                                currentUser.empid && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    navigate(
                                      `/request?edit=${request.ticketNumber}`
                                    )
                                  }
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}

                            {/* Everyone who can see the row can open the detail page */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                navigate(`/swave/${request.ticketNumber}`)
                              }
                            >
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          </Card>
        </ScrollReveal>
      </div>
    </Layout>
  );
};

export default Overview;

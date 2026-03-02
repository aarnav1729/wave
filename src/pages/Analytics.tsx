import { useMemo, useState } from "react";
import Layout from "@/components/Layout";
import ScrollReveal from "@/components/ScrollReveal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getRequests, getHistory } from "@/lib/storage";
import {
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  Download,
  Filter,
  Activity,
  MapPin,
  PieChart,
  CalendarRange,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Analytics = () => {
  const requests = getRequests();
  const history = getHistory();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (filterCategory !== "all" && req.visitorCategory !== filterCategory)
        return false;
      if (filterLocation !== "all" && req.locationToVisit !== filterLocation)
        return false;
      if (filterStatus !== "all" && req.status !== filterStatus) return false;
      return true;
    });
  }, [requests, filterCategory, filterLocation, filterStatus]);

  const stats = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((r) => r.status === "approved").length;
    const pending = requests.filter((r) => r.status === "pending").length;
    const declined = requests.filter((r) => r.status === "declined").length;
    const totalGuests = requests.reduce((sum, r) => sum + r.numberOfGuests, 0);

    const categoryBreakdown = requests.reduce((acc, r) => {
      acc[r.visitorCategory] = (acc[r.visitorCategory] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const locationBreakdown = requests.reduce((acc, r) => {
      acc[r.locationToVisit] = (acc[r.locationToVisit] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // ---------- Time-based metrics ----------
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    let todayCount = 0;
    let last7Count = 0;
    let last30Count = 0;
    let thisMonthCount = 0;

    const dailyTrendMap: Record<string, number> = {};

    // ---------- Location-type metrics (Plant vs Office vs Other) ----------
    const plantOffice = {
      plant: 0,
      office: 0,
      other: 0,
    };

    // ---------- Additional histograms ----------
    const guestHistogram: Record<string, number> = {
      "1": 0,
      "2-3": 0,
      "4-5": 0,
      "6-10": 0,
      "11+": 0,
    };

    const arrivalHistogram: Record<string, number> = {
      "0-6": 0,
      "6-12": 0,
      "12-18": 0,
      "18-24": 0,
    };

    // ---------- History-based metrics (approval time, top approver) ----------
    const historyByTicket = history.reduce((acc, h: any) => {
      if (!h || !h.ticketNumber) return acc;
      if (!acc[h.ticketNumber]) acc[h.ticketNumber] = [];
      acc[h.ticketNumber].push(h);
      return acc;
    }, {} as Record<string, any[]>);

    let totalApprovalHours = 0;
    let approvalSamples = 0;

    const approverCounts: Record<string, number> = {};

    // Count approvals per approver
    history.forEach((h: any) => {
      if (h?.actionType === "APPROVE") {
        const approverId = h.userId || "Unknown";
        approverCounts[approverId] = (approverCounts[approverId] || 0) + 1;
      }
    });

    // Per-request processing
    requests.forEach((r) => {
      // Time metrics
      const created = r.creationDatetime ? new Date(r.creationDatetime) : null;

      if (created && !isNaN(created.getTime())) {
        const createdDay = new Date(created);
        createdDay.setHours(0, 0, 0, 0);
        const diffMs = startOfToday.getTime() - createdDay.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays === 0) todayCount++;
        if (diffDays >= 0 && diffDays < 7) last7Count++;
        if (diffDays >= 0 && diffDays < 30) last30Count++;

        if (
          created.getMonth() === now.getMonth() &&
          created.getFullYear() === now.getFullYear()
        ) {
          thisMonthCount++;
        }

        // Last 14 days volume trend
        if (diffDays >= 0 && diffDays < 14) {
          const dateKey = created.toISOString().split("T")[0]; // YYYY-MM-DD
          dailyTrendMap[dateKey] = (dailyTrendMap[dateKey] || 0) + 1;
        }
      }

      // Location-type metrics
      const typeStr = (r.typeOfLocation || "").toLowerCase();
      const hasPlant = typeStr.includes("plant");
      const hasOffice = typeStr.includes("office");

      if (hasPlant) plantOffice.plant++;
      if (hasOffice) plantOffice.office++;
      if (!hasPlant && !hasOffice) plantOffice.other++;

      // Guest histogram
      const g = r.numberOfGuests || 0;
      if (g <= 1) guestHistogram["1"]++;
      else if (g <= 3) guestHistogram["2-3"]++;
      else if (g <= 5) guestHistogram["4-5"]++;
      else if (g <= 10) guestHistogram["6-10"]++;
      else guestHistogram["11+"]++;

      // Arrival time histogram (based on tentativeArrival hour)
      if (r.tentativeArrival) {
        const arr = new Date(r.tentativeArrival);
        if (!isNaN(arr.getTime())) {
          const hour = arr.getHours();
          if (hour >= 0 && hour < 6) arrivalHistogram["0-6"]++;
          else if (hour >= 6 && hour < 12) arrivalHistogram["6-12"]++;
          else if (hour >= 12 && hour < 18) arrivalHistogram["12-18"]++;
          else arrivalHistogram["18-24"]++;
        }
      }

      // Approval time metrics (only for approved requests)
      if (r.status === "approved" && created && !isNaN(created.getTime())) {
        const events = historyByTicket[r.ticketNumber] || [];
        const approveEvents = events.filter(
          (e: any) => e.actionType === "APPROVE" && e.timestamp
        );

        if (approveEvents.length > 0) {
          let first = approveEvents[0];
          for (const evt of approveEvents) {
            if (
              new Date(evt.timestamp).getTime() <
              new Date(first.timestamp).getTime()
            ) {
              first = evt;
            }
          }

          const createdTs = created.getTime();
          const approvedTs = new Date(first.timestamp).getTime();
          if (approvedTs > createdTs) {
            const diffHours = (approvedTs - createdTs) / (1000 * 60 * 60);
            totalApprovalHours += diffHours;
            approvalSamples++;
          }
        }
      }
    });

    // Prepare daily trend array
    const dailyTrend = Object.entries(dailyTrendMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    // Top approver
    let topApproverId: string | null = null;
    let topApproverCount = 0;
    Object.entries(approverCounts).forEach(([id, count]) => {
      if (count > topApproverCount) {
        topApproverId = id;
        topApproverCount = count;
      }
    });

    const approvalRate =
      total > 0 ? ((approved / total) * 100).toFixed(1) : "0";
    const declineRate = total > 0 ? ((declined / total) * 100).toFixed(1) : "0";
    const pendingRate = total > 0 ? ((pending / total) * 100).toFixed(1) : "0";

    const avgGuestsPerRequest =
      total > 0 ? (totalGuests / total).toFixed(1) : "0.0";

    const avgApprovalTimeHours =
      approvalSamples > 0 ? totalApprovalHours / approvalSamples : 0;
    const avgApprovalTimeLabel =
      approvalSamples > 0 ? avgApprovalTimeHours.toFixed(1) : "—";

    const statusCounts = { approved, pending, declined };

    return {
      total,
      approved,
      pending,
      declined,
      totalGuests,
      categoryBreakdown,
      locationBreakdown,
      approvalRate,
      declineRate,
      pendingRate,
      avgGuestsPerRequest,
      // time buckets
      todayCount,
      last7Count,
      last30Count,
      thisMonthCount,
      // plant vs office
      plantOffice,
      // history-based
      avgApprovalTimeHours,
      avgApprovalTimeLabel,
      topApproverId,
      topApproverCount,
      // volume trend
      dailyTrend,
      // new detailed chart data
      statusCounts,
      guestHistogram,
      arrivalHistogram,
    };
  }, [requests, history]);

  const exportToCSV = () => {
    const headers = [
      "Ticket Number",
      "Requester",
      "Department",
      "Visitor Category",
      "Number of Guests",
      "Location",
      "Arrival Date",
      "Status",
      "Created Date",
    ];

    const rows = filteredRequests.map((req) => [
      req.ticketNumber,
      req.empDetails.empname,
      req.empDetails.dept,
      req.visitorCategory,
      req.numberOfGuests.toString(),
      req.locationToVisit,
      new Date(req.tentativeArrival).toLocaleDateString("en-IN"),
      req.status,
      new Date(req.creationDatetime).toLocaleDateString("en-IN"),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/cv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wave-analytics-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <ScrollReveal>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
              <p className="text-muted-foreground">
                Comprehensive visitor request insights
              </p>
            </div>
            <Button onClick={exportToCSV} className="gap-2">
              <Download className="h-4 w-4" />
              Export Data
            </Button>
          </div>
        </ScrollReveal>

        {/* Key Metrics (existing) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Requests
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">All time requests</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Approval Rate
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.approvalRate}%</div>
              <p className="text-xs text-muted-foreground">
                {stats.approved} approved
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Guests
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalGuests}</div>
              <p className="text-xs text-muted-foreground">
                Across all requests
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pending}</div>
              <p className="text-xs text-muted-foreground">Awaiting approval</p>
            </CardContent>
          </Card>
        </div>

        {/* NEW: Additional summary metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Volumes by time window */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Recent Volume
              </CardTitle>
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Today</span>
                <span className="font-semibold">
                  {stats.todayCount}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    requests
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last 7 days</span>
                <span className="font-semibold">
                  {stats.last7Count}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    requests
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last 30 days</span>
                <span className="font-semibold">
                  {stats.last30Count}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    requests
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t mt-2">
                <span className="text-muted-foreground">
                  This calendar month
                </span>
                <span className="font-semibold">
                  {stats.thisMonthCount}{" "}
                  <span className="text-[11px] text-muted-foreground">
                    requests
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Guests & rates */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Guest & Status Metrics
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Avg guests / request
                </span>
                <span className="font-semibold">
                  {stats.avgGuestsPerRequest}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Decline rate</span>
                <span className="font-semibold text-destructive">
                  {stats.declineRate}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending rate</span>
                <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                  {stats.pendingRate}%
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Approval performance */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Approval Performance
              </CardTitle>
              <Filter className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg approval time</span>
                <span className="font-semibold">
                  {stats.avgApprovalTimeLabel}{" "}
                  {stats.avgApprovalTimeLabel !== "—" && (
                    <span className="text-[11px] text-muted-foreground">
                      hrs
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Most active approver
                </span>
                <span className="font-semibold text-xs">
                  {stats.topApproverId
                    ? `${stats.topApproverId} (${stats.topApproverCount})`
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Breakdown Charts (existing) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Visitor Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stats.categoryBreakdown).map(
                  ([category, count]) => (
                    <div
                      key={category}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-primary" />
                        <span className="text-sm font-medium">{category}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${
                                stats.total > 0
                                  ? (Number(count) / stats.total) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="text-sm font-bold w-8 text-right">
                          {count}
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Location Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stats.locationBreakdown).map(
                  ([location, count]) => (
                    <div
                      key={location}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-accent" />
                        <span className="text-sm font-medium">{location}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent"
                            style={{
                              width: `${
                                stats.total > 0
                                  ? (Number(count) / stats.total) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="text-sm font-bold w-8 text-right">
                          {count}
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* NEW: Plant vs Office + Volume trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Plant vs Office distribution */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Plant vs Office Distribution</CardTitle>
                <CardDescription>
                  Based on type of location in requests
                </CardDescription>
              </div>
              <PieChart className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 text-sm">
                {[
                  {
                    label: "Plant visits",
                    key: "plant" as const,
                    colorClass: "bg-emerald-500",
                  },
                  {
                    label: "Office visits",
                    key: "office" as const,
                    colorClass: "bg-blue-500",
                  },
                  {
                    label: "Other / misc",
                    key: "other" as const,
                    colorClass: "bg-muted-foreground",
                  },
                ].map((item) => {
                  const count = stats.plantOffice[item.key];
                  const totalForDisplay =
                    stats.plantOffice.plant +
                    stats.plantOffice.office +
                    stats.plantOffice.other;
                  const pct =
                    totalForDisplay > 0
                      ? ((count / totalForDisplay) * 100).toFixed(1)
                      : "0.0";

                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${item.colorClass}`}
                        />
                        <span className="font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${item.colorClass}`}
                            style={{
                              width: `${
                                totalForDisplay > 0
                                  ? (count / totalForDisplay) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-right w-16">
                          {count}{" "}
                          <span className="text-[10px] text-muted-foreground">
                            ({pct}%)
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Volume trend (last 14 days) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Request Volume (Last 14 Days)</CardTitle>
                <CardDescription>
                  Daily count of new visitor requests
                </CardDescription>
              </div>
              <MapPin className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats.dailyTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not enough data to display trend yet.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-end gap-1 h-28">
                    {(() => {
                      const maxCount = Math.max(
                        ...stats.dailyTrend.map((d: any) => d.count),
                        1
                      );
                      return stats.dailyTrend.map((day: any) => {
                        const heightPct = (day.count / maxCount) * 100;
                        const label = new Date(day.date).toLocaleDateString(
                          "en-IN",
                          { day: "2-digit", month: "short" }
                        );
                        return (
                          <div
                            key={day.date}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <div
                              className="w-full rounded-t bg-primary/80"
                              style={{
                                height: `${Math.max(6, heightPct)}%`,
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {day.count}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {label}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* NEW: Detailed charts (donut + histograms) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status distribution donut chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Status Distribution</CardTitle>
                <CardDescription>
                  Approved vs Pending vs Declined
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col md:flex-row items-center gap-6">
              {(() => {
                const statusTotal =
                  stats.statusCounts.approved +
                  stats.statusCounts.pending +
                  stats.statusCounts.declined;

                const approvedPct =
                  statusTotal > 0
                    ? (stats.statusCounts.approved / statusTotal) * 100
                    : 0;
                const pendingPct =
                  statusTotal > 0
                    ? (stats.statusCounts.pending / statusTotal) * 100
                    : 0;
                const declinedPct =
                  statusTotal > 0 ? 100 - approvedPct - pendingPct : 0;

                return (
                  <>
                    <div className="relative w-40 h-40">
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          backgroundImage: `conic-gradient(#22c55e 0 ${approvedPct}%, #eab308 ${approvedPct}% ${
                            approvedPct + pendingPct
                          }%, #ef4444 ${approvedPct + pendingPct}% 100%)`,
                        }}
                      />
                      <div className="absolute inset-5 rounded-full bg-background flex flex-col items-center justify-center text-xs">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-base font-semibold">
                          {statusTotal}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 text-sm w-full md:w-auto">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-[#22c55e]" />
                          <span>Approved</span>
                        </div>
                        <span className="font-semibold">
                          {stats.statusCounts.approved}{" "}
                          <span className="text-[11px] text-muted-foreground">
                            ({approvedPct.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-[#eab308]" />
                          <span>Pending</span>
                        </div>
                        <span className="font-semibold">
                          {stats.statusCounts.pending}{" "}
                          <span className="text-[11px] text-muted-foreground">
                            ({pendingPct.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
                          <span>Declined</span>
                        </div>
                        <span className="font-semibold">
                          {stats.statusCounts.declined}{" "}
                          <span className="text-[11px] text-muted-foreground">
                            ({declinedPct.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Guest & arrival histograms */}
          <Card>
            <CardHeader>
              <CardTitle>Distribution Insights</CardTitle>
              <CardDescription>
                Guests per request & arrival time windows
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {/* Guests histogram */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Guests per Request</span>
                  <span className="text-xs text-muted-foreground">
                    Bucketed by group size
                  </span>
                </div>
                {(() => {
                  const entries = Object.entries(stats.guestHistogram);
                  const maxCount =
                    entries.length > 0
                      ? Math.max(...entries.map(([, v]) => v as number), 1)
                      : 1;

                  return (
                    <div className="flex items-end gap-2 h-28">
                      {entries.map(([bucket, count]) => {
                        const heightPct =
                          maxCount > 0 ? (Number(count) / maxCount) * 100 : 0;
                        return (
                          <div
                            key={bucket}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <div
                              className="w-full rounded-t bg-primary/80"
                              style={{
                                height: `${Math.max(6, heightPct)}%`,
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {count}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {bucket}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Arrival time histogram */}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Arrival Time Window</span>
                  <span className="text-xs text-muted-foreground">
                    Based on tentative arrival time
                  </span>
                </div>
                {(() => {
                  const entries = Object.entries(stats.arrivalHistogram);
                  const maxCount =
                    entries.length > 0
                      ? Math.max(...entries.map(([, v]) => v as number), 1)
                      : 1;

                  return (
                    <div className="flex items-end gap-2 h-24">
                      {entries.map(([bucket, count]) => {
                        const heightPct =
                          maxCount > 0 ? (Number(count) / maxCount) * 100 : 0;
                        return (
                          <div
                            key={bucket}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <div
                              className="w-full rounded-t bg-muted-foreground/80"
                              style={{
                                height: `${Math.max(6, heightPct)}%`,
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {count}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {bucket}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Table with Filters (existing) */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Detailed Request Data</CardTitle>
                <CardDescription>
                  {filteredRequests.length} of {requests.length} requests shown
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={filterCategory}
                  onValueChange={setFilterCategory}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {Object.keys(stats.categoryBreakdown).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filterLocation}
                  onValueChange={setFilterLocation}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Locations</SelectItem>
                    {Object.keys(stats.locationBreakdown).map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Requester</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Arrival</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No requests match the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRequests.map((request) => (
                      <TableRow key={request.ticketNumber}>
                        <TableCell className="font-mono text-sm">
                          {request.ticketNumber}
                        </TableCell>
                        <TableCell>{request.empDetails.empname}</TableCell>
                        <TableCell>{request.empDetails.dept}</TableCell>
                        <TableCell>{request.visitorCategory}</TableCell>
                        <TableCell>{request.numberOfGuests}</TableCell>
                        <TableCell>{request.locationToVisit}</TableCell>
                        <TableCell>
                          {new Date(
                            request.tentativeArrival
                          ).toLocaleDateString("en-IN")}
                        </TableCell>
                        <TableCell>
                          {request.status === "approved" && (
                            <Badge className="bg-success text-success-foreground">
                              Approved
                            </Badge>
                          )}
                          {request.status === "pending" && (
                            <Badge className="bg-warning text-warning-foreground">
                              Pending
                            </Badge>
                          )}
                          {request.status === "declined" && (
                            <Badge className="bg-destructive text-destructive-foreground">
                              Declined
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Analytics;

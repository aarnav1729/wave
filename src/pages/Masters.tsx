import { useCallback, useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2 } from "lucide-react";

type LocationType = "Office" | "Plant" | "Warehouse";

type LocationMaster = {
  id: number;
  locationType: LocationType;
  locationName: string;
  plantSite: string | null;
  isCellLine: boolean;
  activeflag: boolean;
  displayOrder: number;
};

type WorkflowSet = {
  id: number;
  setName: string;
  includeOffice: boolean;
  includeWarehouse: boolean;
  includePlant: boolean;
  requiresManager: boolean;
  plantApprovalMode: "none" | "chandra" | "either";
  notes: string | null;
  activeflag: boolean;
};

const toBool = (value: unknown) =>
  value === true || value === 1 || String(value).toLowerCase() === "true";

const Masters = () => {
  const { toast } = useToast();

  const [locations, setLocations] = useState<LocationMaster[]>([]);
  const [workflowSets, setWorkflowSets] = useState<WorkflowSet[]>([]);

  const [loading, setLoading] = useState(true);

  const [locationForm, setLocationForm] = useState({
    id: 0,
    locationType: "Office" as LocationType,
    locationName: "",
    plantSite: "",
    isCellLine: false,
    activeflag: true,
    displayOrder: 0,
  });

  const [workflowForm, setWorkflowForm] = useState({
    id: 0,
    setName: "",
    includeOffice: true,
    includeWarehouse: false,
    includePlant: false,
    requiresManager: true,
    plantApprovalMode: "none" as "none" | "chandra" | "either",
    notes: "",
    activeflag: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [locRes, wfRes] = await Promise.all([
        fetch("/api/masters/locations", { credentials: "include" }),
        fetch("/api/masters/workflow-sets", { credentials: "include" }),
      ]);

      if (!locRes.ok || !wfRes.ok) {
        throw new Error("Failed to load masters data");
      }

      const [locJson, wfJson] = await Promise.all([
        locRes.json() as Promise<{ data?: LocationMaster[] }>,
        wfRes.json() as Promise<{ data?: WorkflowSet[] }>,
      ]);

      setLocations(
        (locJson.data || []).map((x) => ({
          ...x,
          isCellLine: toBool(x.isCellLine),
          activeflag: toBool(x.activeflag),
        }))
      );

      setWorkflowSets(
        (wfJson.data || []).map((x) => ({
          ...x,
          includeOffice: toBool(x.includeOffice),
          includeWarehouse: toBool(x.includeWarehouse),
          includePlant: toBool(x.includePlant),
          requiresManager: toBool(x.requiresManager),
          activeflag: toBool(x.activeflag),
        }))
      );
    } catch (err) {
      toast({
        title: "Failed to load masters",
        description: "Please refresh and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const locationGroups = useMemo(() => {
    return {
      Office: locations.filter((x) => x.locationType === "Office"),
      Plant: locations.filter((x) => x.locationType === "Plant"),
      Warehouse: locations.filter((x) => x.locationType === "Warehouse"),
    };
  }, [locations]);

  const saveLocation = async () => {
    if (!locationForm.locationName.trim()) {
      toast({ title: "Location name required", variant: "destructive" });
      return;
    }

    try {
      const payload = {
        locationType: locationForm.locationType,
        locationName: locationForm.locationName.trim(),
        plantSite: locationForm.locationType === "Plant" ? locationForm.plantSite || null : null,
        isCellLine: locationForm.locationType === "Plant" ? locationForm.isCellLine : false,
        activeflag: locationForm.activeflag,
        displayOrder: locationForm.displayOrder,
      };

      const isEdit = locationForm.id > 0;
      const url = isEdit
        ? `/api/masters/locations/${locationForm.id}`
        : "/api/masters/locations";

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Save failed");
      }

      toast({ title: isEdit ? "Location updated" : "Location created" });
      setLocationForm({
        id: 0,
        locationType: "Office",
        locationName: "",
        plantSite: "",
        isCellLine: false,
        activeflag: true,
        displayOrder: 0,
      });
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please check your data.";
      toast({
        title: "Failed to save location",
        description: message,
        variant: "destructive",
      });
    }
  };

  const deleteLocation = async (id: number) => {
    if (!window.confirm("Delete this location?")) return;
    try {
      const res = await fetch(`/api/masters/locations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Location deleted" });
      await loadData();
    } catch {
      toast({ title: "Failed to delete location", variant: "destructive" });
    }
  };

  const saveWorkflowSet = async () => {
    if (!workflowForm.setName.trim()) {
      toast({ title: "Set name required", variant: "destructive" });
      return;
    }

    try {
      const payload = {
        setName: workflowForm.setName.trim(),
        includeOffice: workflowForm.includeOffice,
        includeWarehouse: workflowForm.includeWarehouse,
        includePlant: workflowForm.includePlant,
        requiresManager: workflowForm.requiresManager,
        plantApprovalMode: workflowForm.includePlant ? workflowForm.plantApprovalMode : "none",
        notes: workflowForm.notes.trim() || null,
        activeflag: workflowForm.activeflag,
      };

      const isEdit = workflowForm.id > 0;
      const url = isEdit
        ? `/api/masters/workflow-sets/${workflowForm.id}`
        : "/api/masters/workflow-sets";

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Save failed");
      }

      toast({ title: isEdit ? "Workflow set updated" : "Workflow set created" });
      setWorkflowForm({
        id: 0,
        setName: "",
        includeOffice: true,
        includeWarehouse: false,
        includePlant: false,
        requiresManager: true,
        plantApprovalMode: "none",
        notes: "",
        activeflag: true,
      });
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please check your data.";
      toast({
        title: "Failed to save workflow set",
        description: message,
        variant: "destructive",
      });
    }
  };

  const deleteWorkflowSet = async (id: number) => {
    if (!window.confirm("Delete this workflow set?")) return;
    try {
      const res = await fetch(`/api/masters/workflow-sets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Workflow set deleted" });
      await loadData();
    } catch {
      toast({ title: "Failed to delete workflow set", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="space-y-8">
        <Card className="overflow-hidden border-none bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
          <CardHeader>
            <CardTitle className="text-3xl">Masters</CardTitle>
            <CardDescription className="text-white/80">
              Manage locations and workflow-by-location sets with production-safe CRUD.
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="hover-lift">
            <CardHeader>
              <CardTitle>Location Master</CardTitle>
              <CardDescription>Create or update Office, Plant, and Warehouse locations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={locationForm.locationType}
                    onValueChange={(v) =>
                      setLocationForm((prev) => ({ ...prev, locationType: v as LocationType }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Office">Office</SelectItem>
                      <SelectItem value="Plant">Plant</SelectItem>
                      <SelectItem value="Warehouse">Warehouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Display Order</Label>
                  <Input
                    type="number"
                    value={locationForm.displayOrder}
                    onChange={(e) =>
                      setLocationForm((prev) => ({
                        ...prev,
                        displayOrder: Number(e.target.value || 0),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Location Name</Label>
                <Input
                  value={locationForm.locationName}
                  onChange={(e) =>
                    setLocationForm((prev) => ({ ...prev, locationName: e.target.value }))
                  }
                  placeholder="e.g., P2 - MonoPerc Cell (PEPPL)"
                />
              </div>

              {locationForm.locationType === "Plant" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plant Site</Label>
                    <Input
                      value={locationForm.plantSite}
                      onChange={(e) =>
                        setLocationForm((prev) => ({ ...prev, plantSite: e.target.value }))
                      }
                      placeholder="P2 / P3 / ..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="block">Cell Line</Label>
                    <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Flag this as cell-line area</span>
                      <Switch
                        checked={locationForm.isCellLine}
                        onCheckedChange={(checked) =>
                          setLocationForm((prev) => ({ ...prev, isCellLine: checked }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Switch
                    checked={locationForm.activeflag}
                    onCheckedChange={(checked) =>
                      setLocationForm((prev) => ({ ...prev, activeflag: checked }))
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveLocation} className="flex-1">
                    <Plus className="h-4 w-4 mr-2" />
                    {locationForm.id ? "Update" : "Create"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setLocationForm({
                        id: 0,
                        locationType: "Office",
                        locationName: "",
                        plantSite: "",
                        isCellLine: false,
                        activeflag: true,
                        displayOrder: 0,
                      })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={4}>Loading...</TableCell>
                      </TableRow>
                    ) : locations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>No locations found.</TableCell>
                      </TableRow>
                    ) : (
                      locations.map((loc) => (
                        <TableRow key={loc.id}>
                          <TableCell>{loc.locationType}</TableCell>
                          <TableCell>
                            <div className="font-medium">{loc.locationName}</div>
                            {loc.plantSite && (
                              <p className="text-xs text-muted-foreground">
                                {loc.plantSite} {loc.isCellLine ? "• Cell line" : ""}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={loc.activeflag ? "default" : "secondary"}>
                              {loc.activeflag ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setLocationForm({
                                  id: loc.id,
                                  locationType: loc.locationType,
                                  locationName: loc.locationName,
                                  plantSite: loc.plantSite || "",
                                  isCellLine: loc.isCellLine,
                                  activeflag: loc.activeflag,
                                  displayOrder: loc.displayOrder,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteLocation(loc.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="hover-lift">
            <CardHeader>
              <CardTitle>Workflow by Location Set</CardTitle>
              <CardDescription>
                Define approval behavior by location combinations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Set Name</Label>
                <Input
                  value={workflowForm.setName}
                  onChange={(e) =>
                    setWorkflowForm((prev) => ({ ...prev, setName: e.target.value }))
                  }
                  placeholder="e.g., Plant (Cell Line)"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Includes Office</span>
                  <Switch
                    checked={workflowForm.includeOffice}
                    onCheckedChange={(checked) =>
                      setWorkflowForm((prev) => ({ ...prev, includeOffice: checked }))
                    }
                  />
                </div>
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Includes Warehouse</span>
                  <Switch
                    checked={workflowForm.includeWarehouse}
                    onCheckedChange={(checked) =>
                      setWorkflowForm((prev) => ({ ...prev, includeWarehouse: checked }))
                    }
                  />
                </div>
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Includes Plant</span>
                  <Switch
                    checked={workflowForm.includePlant}
                    onCheckedChange={(checked) =>
                      setWorkflowForm((prev) => ({ ...prev, includePlant: checked }))
                    }
                  />
                </div>
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Requires Manager</span>
                  <Switch
                    checked={workflowForm.requiresManager}
                    onCheckedChange={(checked) =>
                      setWorkflowForm((prev) => ({ ...prev, requiresManager: checked }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Plant Approval Mode</Label>
                <Select
                  value={workflowForm.includePlant ? workflowForm.plantApprovalMode : "none"}
                  onValueChange={(v) =>
                    setWorkflowForm((prev) => ({
                      ...prev,
                      plantApprovalMode: v as "none" | "chandra" | "either",
                    }))
                  }
                  disabled={!workflowForm.includePlant}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No extra approver</SelectItem>
                    <SelectItem value="chandra">Chandra</SelectItem>
                    <SelectItem value="either">Either Chandra or Saluja</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={workflowForm.notes}
                  onChange={(e) =>
                    setWorkflowForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Short description of approval behavior"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="h-10 rounded-md border px-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Switch
                    checked={workflowForm.activeflag}
                    onCheckedChange={(checked) =>
                      setWorkflowForm((prev) => ({ ...prev, activeflag: checked }))
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={saveWorkflowSet} className="flex-1">
                    <Plus className="h-4 w-4 mr-2" />
                    {workflowForm.id ? "Update" : "Create"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setWorkflowForm({
                        id: 0,
                        setName: "",
                        includeOffice: true,
                        includeWarehouse: false,
                        includePlant: false,
                        requiresManager: true,
                        plantApprovalMode: "none",
                        notes: "",
                        activeflag: true,
                      })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={3}>Loading...</TableCell>
                      </TableRow>
                    ) : workflowSets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>No workflow sets found.</TableCell>
                      </TableRow>
                    ) : (
                      workflowSets.map((wf) => (
                        <TableRow key={wf.id}>
                          <TableCell>
                            <div className="font-medium">{wf.setName}</div>
                            <p className="text-xs text-muted-foreground">{wf.notes || "-"}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">
                              {wf.includeOffice ? "Office " : ""}
                              {wf.includeWarehouse ? "Warehouse " : ""}
                              {wf.includePlant ? "Plant " : ""}
                              • {wf.requiresManager ? "Manager" : "No manager"}
                              {wf.includePlant ? ` • ${wf.plantApprovalMode}` : ""}
                            </p>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setWorkflowForm({
                                  id: wf.id,
                                  setName: wf.setName,
                                  includeOffice: wf.includeOffice,
                                  includeWarehouse: wf.includeWarehouse,
                                  includePlant: wf.includePlant,
                                  requiresManager: wf.requiresManager,
                                  plantApprovalMode: wf.plantApprovalMode,
                                  notes: wf.notes || "",
                                  activeflag: wf.activeflag,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteWorkflowSet(wf.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
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

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Loaded locations: Office {locationGroups.Office.length}, Plant {locationGroups.Plant.length}, Warehouse {locationGroups.Warehouse.length}.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Masters;

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/_components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";
import { Label } from "@/app/_components/ui/label";
import { useToast } from "@/app/_components/ui/use-toast";
import { Plus, Search, Edit, Trash2, AlertCircle, Upload } from "lucide-react";
import { Badge } from "@/app/_components/ui/badge";
import { Alert, AlertDescription } from "@/app/_components/ui/alert";
import type { ImportSummary } from "@/lib/class-types-import";

interface ClassType {
  id: string;
  name: string;
  /** Code of the imported class list (e.g. "1.7.3"); null for a class typed by hand.
   */
  code: string | null;
  position: number | null;
  /**Id of the parent class, when the class is a sub-class
   */
  relatedId: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  _count: {
    annotationTypes: number;
  };
}

interface Props {
  slug: string;
  /** True for a member without settings:write — the API refuses those calls with a 403. */
  readOnly: boolean;
}

export function ClassTypesClient({ slug, readOnly }: Props) {
  const t = useTranslations("Project.ClassTypes");
  const { toast } = useToast();

  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedClassType, setSelectedClassType] = useState<ClassType | null>(null);

  // Form states
  const [formName, setFormName] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  //Import states
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Load class types
  const loadClassTypes = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${slug}/class-types`);
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setClassTypes(data);
    } catch (error) {
      toast({
        title: t("errors.load"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClassTypes();
  }, [slug]);

  // Filter class types
  const filteredClassTypes = classTypes.filter((ct) => {
    const matchesSearch = ct.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || ct.status === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  // Create class type
  const handleCreate = async () => {
    if (!formName.trim()) return;

    try {
      setFormSubmitting(true);
      const response = await fetch(`/api/projects/${slug}/class-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 409) {
          toast({
            title: t("errors.duplicate"),
            variant: "destructive",
          });
          return;
        }
        throw new Error(error.error);
      }

      toast({ title: t("success.created") });
      setAddDialogOpen(false);
      setFormName("");
      loadClassTypes();
    } catch (error) {
      toast({
        title: t("errors.create"),
        variant: "destructive",
      });
    } finally {
      setFormSubmitting(false);
    }
  };

  // Update class type
  const handleUpdate = async () => {
    if (!selectedClassType || !formName.trim()) return;

    try {
      setFormSubmitting(true);
      const response = await fetch(
        `/api/projects/${slug}/class-types/${selectedClassType.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim() }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 409) {
          toast({
            title: t("errors.duplicate"),
            variant: "destructive",
          });
          return;
        }
        throw new Error(error.error);
      }

      toast({ title: t("success.updated") });
      setEditDialogOpen(false);
      setSelectedClassType(null);
      setFormName("");
      loadClassTypes();
    } catch (error) {
      toast({
        title: t("errors.update"),
        variant: "destructive",
      });
    } finally {
      setFormSubmitting(false);
    }
  };

  // Delete class type
  const handleDelete = async () => {
    if (!selectedClassType) return;

    try {
      setFormSubmitting(true);
      const response = await fetch(
        `/api/projects/${slug}/class-types/${selectedClassType.id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete");

      toast({ title: t("success.deleted") });
      setDeleteDialogOpen(false);
      setSelectedClassType(null);
      loadClassTypes();
    } catch (error) {
      toast({
        title: t("errors.delete"),
        variant: "destructive",
      });
    } finally {
      setFormSubmitting(false);
    }
  };

  // Toggle status
  const handleToggleStatus = async (classType: ClassType) => {
    try {
      const newStatus = classType.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      const response = await fetch(`/api/projects/${slug}/class-types/${classType.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update");

      toast({
        title: newStatus === "ACTIVE" ? t("success.activated") : t("success.deactivated"),
      });
      loadClassTypes();
    } catch (error) {
      toast({
        title: t("errors.update"),
        variant: "destructive",
      });
    }
  };

  // Open edit dialog
  const openEditDialog = (classType: ClassType) => {
    setSelectedClassType(classType);
    setFormName(classType.name);
    setEditDialogOpen(true);
  };

  // Open delete dialog
  const openDeleteDialog = (classType: ClassType) => {
    setSelectedClassType(classType);
    setDeleteDialogOpen(true);
  };

  // Import: the file is first sent as a dry run, so the dialog can show what the
  // import would do; nothing is written until the user confirms.
  const runImport = async (csv: string, dryRun: boolean): Promise<ImportSummary> => {
    const response = await fetch(`/api/projects/${slug}/class-types/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, dryRun }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // A rejected file (400) or a conflict (409) comes with a message written for the user.
      const isFileProblem =
        (response.status === 400 || response.status === 409) &&
        typeof data?.error === "string" &&
        !data.details;
      throw new Error(isFileProblem ? data.error : t("import.errors.failed"));
    }
    return data as ImportSummary;
  };

  const handleImportFile = async (file: File | undefined) => {
    setImportCsv(null);
    setImportSummary(null);
    setImportError(null);
    if (!file) return;

    try {
      setImporting(true);
      const csv = await file.text();
      if (!csv.trim()) {
        setImportError(t("import.errors.emptyFile"));
        return;
      }
      const summary = await runImport(csv, true);
      setImportCsv(csv);
      setImportSummary(summary);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("import.errors.failed"));
    } finally {
      setImporting(false);
    }
  };

  const closeImportDialog = () => {
    setImportDialogOpen(false);
    setImportCsv(null);
    setImportSummary(null);
    setImportError(null);
  };

  const handleImportConfirm = async () => {
    if (!importCsv) return;

    try {
      setImporting(true);
      await runImport(importCsv, false);
      toast({ title: t("import.success") });
      closeImportDialog();
      loadClassTypes();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("import.errors.failed"));
    } finally {
      setImporting(false);
    }
  };

  const importChanges = importSummary
    ? importSummary.created.length + importSummary.adopted.length + importSummary.updated.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder={t("statusFilter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="active">{t("status.active")}</SelectItem>
              <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(true)}
            disabled={readOnly}
          >
            <Upload className="h-4 w-4 mr-2" />
            {t("import.button")}
          </Button>
          <Button onClick={() => setAddDialogOpen(true)} disabled={readOnly}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addNew")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.code")}</TableHead>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.created")}</TableHead>
              <TableHead>{t("table.usage")}</TableHead>
              <TableHead className="text-right">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  {t("loading", { ns: "Common" })}...
                </TableCell>
              </TableRow>
            ) : filteredClassTypes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">{t("empty")}</p>
                    <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredClassTypes.map((classType) => (
                <TableRow key={classType.id}>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {classType.code ?? ""}</TableCell>
                  <TableCell className={classType.relatedId ? "font-medium pl-8" : "font-medium"}>
                    {classType.name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={classType.status === "ACTIVE" ? "default" : "secondary"}
                      className={readOnly ? undefined : "cursor-pointer"}
                      onClick={
                        readOnly ? undefined : () => handleToggleStatus(classType)
                      }
                    >
                      {classType.status === "ACTIVE"
                        ? t("status.active")
                        : t("status.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(classType.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {t("usage", { count: classType._count.annotationTypes })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(classType)}
                        disabled={readOnly}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteDialog(classType)}
                        disabled={readOnly}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.add.title")}</DialogTitle>
            <DialogDescription>{t("dialog.add.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("form.name")}</Label>
              <Input
                id="name"
                placeholder={t("form.namePlaceholder")}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                setFormName("");
              }}
            >
              {t("dialog.delete.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={formSubmitting || !formName.trim()}>
              {formSubmitting ? t("submitting", { ns: "Common" }) : t("dialog.add.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.edit.title")}</DialogTitle>
            <DialogDescription>{t("dialog.edit.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t("form.name")}</Label>
              <Input
                id="edit-name"
                placeholder={t("form.namePlaceholder")}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setSelectedClassType(null);
                setFormName("");
              }}
            >
              {t("dialog.delete.cancel")}
            </Button>
            <Button onClick={handleUpdate} disabled={formSubmitting || !formName.trim()}>
              {formSubmitting ? t("submitting", { ns: "Common" }) : t("dialog.edit.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.delete.title")}</DialogTitle>
            <DialogDescription>{t("dialog.delete.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {selectedClassType && selectedClassType._count.annotationTypes > 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("dialog.delete.inUse", {
                    count: selectedClassType._count.annotationTypes,
                  })}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>{t("dialog.delete.notInUse")}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setSelectedClassType(null);
              }}
            >
              {t("dialog.delete.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={formSubmitting}>
              {formSubmitting ? t("submitting", { ns: "Common" }) : t("dialog.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => (open ? setImportDialogOpen(true) : closeImportDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("import.title")}</DialogTitle>
            <DialogDescription>{t("import.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="import-file">{t("import.file")}</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                disabled={importing}
                onChange={(e) => handleImportFile(e.target.files?.[0])}
              />
            </div>

            {importError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}

            {importSummary && (
              <Alert>
                <AlertDescription>
                  {importChanges === 0 ? (
                    <p>{t("import.summary.nothingToDo")}</p>
                  ) : (
                    <ul className="list-disc pl-5 space-y-1">
                      <li>{t("import.summary.created", { count: importSummary.created.length })}</li>
                      <li>{t("import.summary.adopted", { count: importSummary.adopted.length })}</li>
                      <li>{t("import.summary.updated", { count: importSummary.updated.length })}</li>
                      <li>{t("import.summary.unchanged", { count: importSummary.unchanged })}</li>
                    </ul>
                  )}
                  {importSummary.notInFile.length > 0 && (
                    <p className="mt-3">
                      {t("import.summary.notInFile", { count: importSummary.notInFile.length })}{" "}
                      {importSummary.notInFile.map((classType) => classType.name).join(", ")}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeImportDialog}>
              {t("dialog.delete.cancel")}
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={importing || !importCsv || importChanges === 0}
            >
              {importing ? t("import.working") : t("import.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

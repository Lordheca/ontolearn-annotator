"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, User, CheckCircle2, Clock, Eye, FileImage } from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import AoiPreviewModal from "@/app/_components/annotations/aoi-preview-modal";

// Use Prisma's actual return type structure
type DataFile = {
  id: string;
  name: string | null;
  type: string;
  filePath: string | null;
  createdAt: Date;
  annotations: Array<{
    id: string;
    author: string;
    userId: string | null;
    confidence: number | null;
    quality: string | null;
    createdAt: Date;
    annotationTypes: Array<{
      annotationId: string;
      classTypeId: string;
      rank: number;
      classType: {
        id: string;
        projectId: string;
        name: string;
        status: string;
        relatedId: string | null;
        createdAt: Date;
        updatedAt: Date;
        value?: string | null;
        label?: string | null;
      };
    }>;
    areaOfInterest: any;
  }>;
};

type Props = {
  slug: string;
  dataFiles: DataFile[];
};

type FilterStatus = "all" | "annotated" | "pending";
type SortField = "name" | "createdAt" | "annotationDate" | "annotationCount";
type SortOrder = "asc" | "desc";

export function AnnotationsTableClient({ slug, dataFiles }: Props) {
  const t = useTranslations("Annotations");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Process and filter data
  const filteredAndSorted = useMemo(() => {
    let filtered = dataFiles;

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((df) =>
        (df.name || "").toLowerCase().includes(searchLower)
      );
    }

    // Status filter
    if (filterStatus === "annotated") {
      filtered = filtered.filter((df) => df.annotations.length > 0);
    } else if (filterStatus === "pending") {
      filtered = filtered.filter((df) => df.annotations.length === 0);
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case "name":
          aValue = (a.name || "").toLowerCase();
          bValue = (b.name || "").toLowerCase();
          break;
        case "createdAt":
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        case "annotationDate":
          aValue = a.annotations.length > 0
            ? Math.max(...a.annotations.map((ann) => new Date(ann.createdAt).getTime()))
            : 0;
          bValue = b.annotations.length > 0
            ? Math.max(...b.annotations.map((ann) => new Date(ann.createdAt).getTime()))
            : 0;
          break;
        case "annotationCount":
          aValue = a.annotations.length;
          bValue = b.annotations.length;
          break;
      }

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return sorted;
  }, [dataFiles, search, filterStatus, sortField, sortOrder]);

  const stats = useMemo(() => {
    const total = dataFiles.length;
    const annotated = dataFiles.filter((df) => df.annotations.length > 0).length;
    const pending = total - annotated;
    const totalAnnotations = dataFiles.reduce((sum, df) => sum + df.annotations.length, 0);

    return { total, annotated, pending, totalAnnotations };
  }, [dataFiles]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const getLatestAnnotationDate = (df: DataFile) => {
    if (df.annotations.length === 0) return null;
    const latest = df.annotations.reduce((latest, ann) =>
      new Date(ann.createdAt) > new Date(latest.createdAt) ? ann : latest
    );
    return new Date(latest.createdAt);
  };

  const getAnnotators = (df: DataFile) => {
    const authors = new Set(df.annotations.map((ann) => ann.author));
    return Array.from(authors);
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FileImage className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("stats.totalFiles")}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("stats.annotated")}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.annotated}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("stats.pending")}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.pending}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <User className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("stats.totalAnnotations")}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.totalAnnotations}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder={t("search.placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            <Button
              variant={filterStatus === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("all")}
            >
              {t("filters.all")} ({stats.total})
            </Button>
            <Button
              variant={filterStatus === "annotated" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("annotated")}
              className={filterStatus === "annotated" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              {t("filters.annotatedBtn")} ({stats.annotated})
            </Button>
            <Button
              variant={filterStatus === "pending" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("pending")}
              className={filterStatus === "pending" ? "bg-yellow-600 hover:bg-yellow-700 text-white" : ""}
            >
              <Clock className="w-4 h-4 mr-1" />
              {t("filters.pendingBtn")} ({stats.pending})
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center gap-2">
                    {t("table.filename")}
                    {sortField === "name" && (
                      <span className="text-gray-400 dark:text-gray-500">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("table.type")}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("table.status")}
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => handleSort("annotationCount")}
                >
                  <div className="flex items-center gap-2">
                    {t("table.annotations")}
                    {sortField === "annotationCount" && (
                      <span className="text-gray-400 dark:text-gray-500">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => handleSort("annotationDate")}
                >
                  <div className="flex items-center gap-2">
                    {t("table.lastAnnotated")}
                    {sortField === "annotationDate" && (
                      <span className="text-gray-400 dark:text-gray-500">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("table.annotators")}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredAndSorted.map((df) => {
                const annotated = df.annotations.length > 0;
                const latestDate = getLatestAnnotationDate(df);
                const annotators = getAnnotators(df);

                return (
                  <tr key={df.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center">
                          <FileImage className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{df.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {t("table.added", { date: new Date(df.createdAt).toLocaleDateString() })}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                        {df.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {annotated ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {t("status.complete")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <Clock className="w-3 h-3 mr-1" />
                          {t("status.pending")}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                        {df.annotations.length}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {latestDate ? (
                        <div>
                          <div className="text-sm text-gray-900 dark:text-gray-100">
                            {latestDate.toLocaleDateString()}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {latestDate.toLocaleTimeString()}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500">{t("table.noAnnotator")}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {annotators.length > 0 ? (
                        <div className="flex items-center gap-1">
                          <User className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{annotators.join(", ")}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-gray-500">{t("table.noAnnotator")}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {!annotated && (
                          <Link href={`/projects/${slug}/annotations/${df.id}`}>
                            <Button size="sm" variant="default">
                              {t("actions.annotate")}
                            </Button>
                          </Link>
                        )}
                        {annotated && (() => {
                          // Build AOIs from unique AreaOfInterest ids
                          type NormalizedAoi = {
                            type: "polygon" | "rectangle";
                            coordinates: any;
                            meta?: {
                              id?: string;
                              annotations?: Array<{
                                author?: string;
                                userId?: string | null;
                                confidence?: number | null;
                                quality?: string | null;
                                createdAt?: string | Date;
                                classes?: Array<{ value: string; label?: string; rank: number }>;
                              }>;
                            };
                          };

                          const aoiMap = new Map<string, NormalizedAoi>();

                          // First pass: create AOI entries
                          for (const ann of df.annotations) {
                            const aoi = ann.areaOfInterest as any;
                            if (!aoi?.area || !aoi?.id) continue;
                            if (!aoiMap.has(aoi.id)) {
                              const area = aoi.area as any;
                              const normalized: NormalizedAoi = Array.isArray(area)
                                ? { type: "polygon", coordinates: area, meta: { id: aoi.id, annotations: [] } }
                                : { type: "rectangle", coordinates: area, meta: { id: aoi.id, annotations: [] } };
                              aoiMap.set(aoi.id, normalized);
                            }
                          }

                          // Second pass: attach annotation info
                          for (const ann of df.annotations) {
                            const aoi = ann.areaOfInterest as any;
                            if (!aoi?.id) continue;
                            const entry = aoiMap.get(aoi.id);
                            if (!entry) continue;
                            const classes = (ann.annotationTypes || []).map((at) => {
                              const ct: any = at.classType;
                              const value = ct?.value ?? ct?.name ?? String(ct?.id ?? "");
                              return {
                                value,
                                label: ct?.name ?? ct?.label ?? undefined,
                                rank: at.rank,
                              };
                            });
                            entry.meta!.annotations!.push({
                              author: ann.author,
                              userId: ann.userId,
                              confidence: ann.confidence,
                              quality: ann.quality,
                              createdAt: ann.createdAt as any,
                              classes,
                            });
                          }

                          const aois = Array.from(aoiMap.values());
                          return (
                            <AoiPreviewModal
                              trigger={
                                <Button size="sm" variant="outline">
                                  <Eye className="w-4 h-4 mr-1" />
                                  {t("actions.view")}
                                </Button>
                              }
                              imageUrl={`/api/files/${df.id}`}
                              aois={aois as any}
                              title={df.name || t("modal.title")}
                              annotationCount={df.annotations.length}
                              aoiCount={aois.length}
                              annotators={annotators}
                              lastAnnotated={latestDate}
                            />
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredAndSorted.length === 0 && (
          <div className="text-center py-12">
            <FileImage className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">{t("search.noResults")}</p>
            {search && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setSearch("")}
                className="mt-2"
              >
                {t("search.clearSearch")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
